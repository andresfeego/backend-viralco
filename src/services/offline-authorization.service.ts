import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ServiceError } from '../lib/service-error.ts';
import { assertBillingActive, billingState } from './billing.service.ts';

const failure = () => new ServiceError(403, JSON.stringify({ code: 'BILLING_OPERATION_BLOCKED', message: 'Conecta el dispositivo y revisa la vigencia de la cuenta' }));
function key() { return createPrivateKey(readFileSync(process.env.OFFLINE_SIGNING_KEY_FILE || '.secrets/offline-ed25519.pem')); }
export function signOfflineAuthorization(claims: any) {
  const payload = Buffer.from(JSON.stringify({ ...claims, purpose: 'kaptura-offline-operation', v: 2 })).toString('base64');
  return { payload, signature: sign(null, Buffer.from(payload, 'base64'), key()).toString('base64') };
}
export function verifyOfflineAuthorization(grant: any) {
  if (typeof grant?.payload !== 'string' || typeof grant?.signature !== 'string' || grant.payload.length > 12000 || grant.signature.length > 128) throw failure();
  const bytes = Buffer.from(grant.payload, 'base64');
  if (!verify(null, bytes, createPublicKey(key()), Buffer.from(grant.signature, 'base64'))) throw failure();
  const claims = JSON.parse(bytes.toString());
  if (claims.v !== 2 || claims.purpose !== 'kaptura-offline-operation' || !Number.isFinite(claims.issuedAt) || !Number.isFinite(claims.expiresAt) || claims.expiresAt <= claims.issuedAt) throw failure();
  return claims;
}
export async function issueOfflineAuthorization(context: any, user: any, deviceId: string) {
  if (!/^[A-Za-z0-9_.-]{3,120}$/.test(deviceId)) throw new ServiceError(400, 'Dispositivo requerido');
  const state = await assertBillingActive(context.event.accountId, 'espejo');
  const issuedAt = Date.now();
  const periods = state.system ? [{ startsAt: issuedAt, endsAt: issuedAt + 30 * 86400000, services: ['espejo', 'cabina', 'video-360'] }]
    : state.periods.filter((p: any) => new Date(p.endsAt).getTime() > issuedAt).map((p: any) => ({ startsAt: new Date(p.startsAt).getTime(), endsAt: new Date(p.endsAt).getTime(), services: p.services.map((m: any) => m.slug) }));
  return signOfflineAuthorization({ userId: String(user.id), accountId: String(context.event.accountId), eventId: String(context.eventId), eventModeId: String(context.eventModeId), deviceId,
    services: state.system ? ['espejo', 'cabina', 'video-360'] : state.current.services.map((m: any) => m.slug), issuedAt, periods,
    expiresAt: Math.max(...periods.map((p: any) => p.endsAt)) });
}

// Proof lives only in the mobile process, not in capture archives. Current role
// and administrative checks must still run before this commercial exception.
export async function assertRuntimeBilling(context: any, user: any, session?: any) {
  const state = await billingState(context.event.accountId);
  if (state.administrativelyBlocked) throw failure();
  if (state.active) {
    if (!state.system && !state.current.services.some((m: any) => m.slug === 'espejo')) throw failure();
    return { continuity: false };
  }
  const proof = user?.billingLiveProof;
  if (!proof || !session) throw failure();
  const grant = verifyOfflineAuthorization(proof.grant);
  const start = Number(proof.startedAt);
  if (state.periods?.some((p: any) => new Date(p.startsAt).getTime() > start && new Date(p.startsAt).getTime() <= Date.now() && !p.services.some((m: any) => m.slug === 'espejo'))) throw failure();
  if (grant.periods && !grant.periods.some((p: any) => p.startsAt <= start && start < p.endsAt && p.services.includes('espejo'))) throw failure();
  const metadata = typeof session.metadata === 'string' ? JSON.parse(session.metadata) : session.metadata;
  if (['ended', 'failed'].includes(session.status) && !metadata?.offline) throw failure();
  if (grant.userId !== String(user.id) || grant.accountId !== String(context.event.accountId) || grant.eventId !== String(context.eventId) || grant.eventModeId !== String(context.eventModeId)
    || grant.deviceId !== String(session.deviceInstallationId) || String(session.startedBy) !== String(user.id)
    || !grant.services.includes('espejo') || !proof.processId || proof.clientSessionId !== session.clientSessionId
    || !Number.isFinite(start) || start < grant.issuedAt || start >= grant.expiresAt || start > Date.now()) throw failure();
  return { continuity: true, startedAt: start };
}
export function readBillingLiveProof(req: any, _res: any, next: any) {
  const value = req.headers['x-kaptura-live-proof'];
  if (typeof value === 'string' && value.length <= 20000) {
    try { req.authUser.billingLiveProof = JSON.parse(Buffer.from(value, 'base64').toString()); } catch { /* Invalid proof never grants continuity. */ }
  }
  next();
}
