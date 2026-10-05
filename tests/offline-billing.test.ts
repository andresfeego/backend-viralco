import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: vi.fn(), key: vi.fn() }));
vi.mock('node:fs', async original => ({ ...(await original<any>()), readFileSync: mocks.key }));
vi.mock('../src/services/billing.service.ts', () => ({ billingState: mocks.state, assertBillingActive: mocks.state }));
import { generateKeyPairSync } from 'node:crypto';
import { assertRuntimeBilling, signOfflineAuthorization, verifyOfflineAuthorization } from '../src/services/offline-authorization.service.ts';
const pair = generateKeyPairSync('ed25519');
const context = { eventId: 3n, eventModeId: 4n, event: { accountId: 2n } };
const claims = { userId: '1', accountId: '2', eventId: '3', eventModeId: '4', deviceId: 'phone', services: ['espejo'], issuedAt: 1000, expiresAt: 3000 };
beforeEach(() => { vi.clearAllMocks(); mocks.key.mockReturnValue(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })); mocks.state.mockResolvedValue({ active: false, administrativelyBlocked: false }); });
it('signs and verifies without sharing a symmetric key with the client', () => {
  expect(verifyOfflineAuthorization(signOfflineAuthorization(claims))).toMatchObject(claims);
  const signed = signOfflineAuthorization(claims);
  signed.payload = Buffer.from(JSON.stringify({ ...claims, expiresAt: 999999 })).toString('base64');
  expect(() => verifyOfflineAuthorization(signed)).toThrow();
});
it('permits only the exact live session after commercial expiry', async () => {
  const requester = { id: '1', billingLiveProof: { grant: signOfflineAuthorization(claims), startedAt: 2000, processId: 'process', clientSessionId: 'live' } };
  const session = { clientSessionId: 'live', deviceInstallationId: 'phone', startedBy: 1n, status: 'running' };
  await expect(assertRuntimeBilling(context, requester, session)).resolves.toMatchObject({ continuity: true });
  for (const patch of [{ clientSessionId: 'old' }, { deviceInstallationId: 'other' }, { startedBy: 2n }, { status: 'ended' }]) await expect(assertRuntimeBilling(context, requester, { ...session, ...patch })).rejects.toMatchObject({ status: 403 });
  await expect(assertRuntimeBilling(context, { id: '1' }, session)).rejects.toMatchObject({ status: 403 });
  mocks.state.mockResolvedValue({ active: false, administrativelyBlocked: true });
  await expect(assertRuntimeBilling(context, requester, session)).rejects.toMatchObject({ status: 403 });
});
