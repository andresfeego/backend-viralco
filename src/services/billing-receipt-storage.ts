import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { ServiceError } from '../lib/service-error.ts';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const RECEIPT_URL_TTL_SECONDS = 120;
const ALLOWED_TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['application/pdf', 'pdf']]);
const RECEIPT_KEY = /^receipts\/v1\/[1-9][0-9]*\/[0-9a-f-]{36}\.(jpg|png|pdf)$/;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceError(503, 'El almacenamiento privado de comprobantes no esta configurado');
  return value;
}

export function billingStorageConfig() {
  const bucket = required('BILLING_R2_BUCKET_NAME');
  const accountId = required('BILLING_R2_ACCOUNT_ID');
  if (bucket === process.env.R2_BUCKET_NAME?.trim()) {
    throw new ServiceError(503, 'Los comprobantes requieren un bucket distinto al de recursos');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new ServiceError(503, 'Configuracion de almacenamiento privado invalida');
  }
  return {
    bucket,
    client: new S3Client({
      region: process.env.BILLING_R2_BUCKET_REGION?.trim() || 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: required('BILLING_R2_ACCESS_KEY_ID'),
        secretAccessKey: required('BILLING_R2_SECRET_ACCESS_KEY'),
      },
    }),
  };
}

export async function validateBillingReceipt(file: { buffer: Buffer; mimetype: string }) {
  if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length || file.buffer.length > MAX_RECEIPT_BYTES) {
    throw new ServiceError(400, 'Adjunta un comprobante JPG, PNG o PDF de hasta 10 MB');
  }
  let detected;
  try { detected = await fileTypeFromBuffer(file.buffer); } catch { /* Invalid/truncated signature. */ }
  if (!detected || !ALLOWED_TYPES.has(detected.mime) || detected.mime !== file.mimetype) {
    throw new ServiceError(400, 'El comprobante debe ser un archivo JPG, PNG o PDF valido');
  }
  return { contentType: detected.mime, extension: ALLOWED_TYPES.get(detected.mime)!, sizeBytes: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') };
}

// Internal storage adapter only. The calling billing service must first authorize
// the account/order and persist this receipt's association before exposing its ID.
export async function storeBillingReceipt(accountId: string, file: { buffer: Buffer; mimetype: string }) {
  if (!/^[1-9][0-9]*$/.test(accountId)) throw new ServiceError(400, 'Cuenta invalida');
  const metadata = await validateBillingReceipt(file);
  const { client, bucket } = billingStorageConfig();
  const key = `receipts/v1/${accountId}/${randomUUID()}.${metadata.extension}`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: file.buffer,
      ContentType: metadata.contentType,
      ContentDisposition: `attachment; filename="comprobante.${metadata.extension}"`,
      CacheControl: 'private, no-store',
      Metadata: { sha256: metadata.sha256 },
    }));
    // No public URL is ever stored or returned.
    return { key, ...metadata };
  } finally { client.destroy(); }
}

// Never expose this adapter directly as a route accepting arbitrary keys. The
// caller must load the receipt by ID and authorize its account or superadmin.
export async function signAuthorizedBillingReceipt(receipt: { key: string; accountId: string }) {
  if (!RECEIPT_KEY.test(receipt.key) || !receipt.key.startsWith(`receipts/v1/${receipt.accountId}/`)) {
    throw new ServiceError(404, 'Comprobante no encontrado');
  }
  const { client, bucket } = billingStorageConfig();
  try {
    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket, Key: receipt.key, ResponseCacheControl: 'private, no-store',
      ResponseContentDisposition: `attachment; filename="comprobante.${receipt.key.split('.').pop()}"`,
    }), { expiresIn: RECEIPT_URL_TTL_SECONDS });
    return { url, expiresInSeconds: RECEIPT_URL_TTL_SECONDS };
  } finally { client.destroy(); }
}
