import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), destroy: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = mocks.send; destroy = mocks.destroy; },
  PutObjectCommand: class { constructor(public input: any) {} },
  GetObjectCommand: class { constructor(public input: any) {} },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }));
import { billingStorageConfig, MAX_RECEIPT_BYTES, signAuthorizedBillingReceipt, storeBillingReceipt, validateBillingReceipt } from '../src/services/billing-receipt-storage.ts';
const file = { buffer: Buffer.from('%PDF-1.7\nreceipt fixture\n%%EOF'), mimetype: 'application/pdf' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BILLING_R2_BUCKET_NAME', 'private-receipts');
  vi.stubEnv('BILLING_R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('BILLING_R2_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('BILLING_R2_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('R2_BUCKET_NAME', 'public-media');
  mocks.send.mockResolvedValue({});
  mocks.sign.mockResolvedValue('https://private.example/signed');
});
afterEach(() => vi.unstubAllEnvs());

describe('private receipt storage', () => {
  it('requires dedicated storage and credentials without media fallback', () => {
    vi.stubEnv('BILLING_R2_SECRET_ACCESS_KEY', '');
    expect(() => billingStorageConfig()).toThrow();
    vi.stubEnv('BILLING_R2_SECRET_ACCESS_KEY', 'test');
    vi.stubEnv('BILLING_R2_BUCKET_NAME', 'public-media');
    expect(() => billingStorageConfig()).toThrow();
  });
  it('validates the bytes rather than filename or declared MIME alone', async () => {
    await expect(validateBillingReceipt({ buffer: Buffer.from('<html>'), mimetype: 'application/pdf' })).rejects.toThrow();
    await expect(validateBillingReceipt({ ...file, mimetype: 'image/png' })).rejects.toThrow();
    await expect(validateBillingReceipt(file)).resolves.toMatchObject({ contentType: 'application/pdf', extension: 'pdf' });
  });
  it('rejects empty or oversized receipts', async () => {
    for (const buffer of [Buffer.alloc(0), Buffer.alloc(MAX_RECEIPT_BYTES + 1)]) {
      await expect(validateBillingReceipt({ buffer, mimetype: 'application/pdf' })).rejects.toThrow();
    }
  });
  it('uploads into the dedicated bucket without returning a public URL', async () => {
    const receipt = await storeBillingReceipt('12', file);
    expect(receipt.key).toMatch(/^receipts\/v1\/12\/.+\.pdf$/);
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt).not.toHaveProperty('url');
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: 'private-receipts', CacheControl: 'private, no-store', ContentType: 'application/pdf' });
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it('uses opaque keys but consistent hashes to detect duplicate reports', async () => {
    const first = await storeBillingReceipt('12', file);
    const second = await storeBillingReceipt('12', file);
    expect(first.key).not.toBe(second.key);
    expect(first.sha256).toBe(second.sha256);
  });
  it('rejects invalid account paths before upload', async () => {
    await expect(storeBillingReceipt('../12', file)).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('issues short signed attachment links, scoped to the stored account', async () => {
    const result = await signAuthorizedBillingReceipt({ key: 'receipts/v1/12/11111111-1111-4111-8111-111111111111.pdf', accountId: '12' });
    expect(result.expiresInSeconds).toBe(120);
    expect(mocks.sign.mock.calls[0][1].input.Bucket).toBe('private-receipts');
    expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 120 });
  });
  it.each(['resources/file.pdf', 'receipts/v1/13/11111111-1111-4111-8111-111111111111.pdf', 'receipts/v1/12/../../media.png'])('does not sign arbitrary or mismatched paths: %s', async key => {
    await expect(signAuthorizedBillingReceipt({ key, accountId: '12' })).rejects.toThrow();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
