import { ServiceError } from '../lib/service-error.ts';

export const BILLING_DURATIONS = [30, 365] as const;
export type BillingDuration = typeof BILLING_DURATIONS[number];
export const BILLING_DAY_MS = 86_400_000;

export function billingDuration(value: unknown): BillingDuration {
  if (value !== 30 && value !== 365) throw new ServiceError(400, 'Periodicidad invalida');
  return value;
}

// COP is represented in whole pesos, never float amounts or inferred USD conversions.
export function copAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ServiceError(400, 'El importe debe ser un numero entero positivo en COP');
  }
  return value;
}

function timestamp(value: string | Date | number): number {
  const result = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(result)) throw new ServiceError(400, 'Fecha invalida');
  return result;
}

export type CommercialMode = {
  modeId: string;
  slug: string;
  name: string;
  available: boolean;
  implemented: boolean;
  prices: Partial<Record<BillingDuration, number | null>>;
};

export function quoteModes(catalog: CommercialMode[], selectedIds: string[], durationInput: unknown) {
  const durationDays = billingDuration(durationInput);
  if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) {
    throw new ServiceError(400, 'Selecciona servicios sin duplicados');
  }
  const items = selectedIds.map(modeId => {
    const mode = catalog.find(item => item.modeId === modeId);
    if (!mode?.available || !mode.implemented) throw new ServiceError(409, 'Servicio no disponible para contratacion');
    const amountCop = copAmount(mode.prices[durationDays]);
    return { modeId, slug: mode.slug, name: mode.name, amountCop };
  });
  const amountCop = copAmount(items.reduce((total, item) => total + item.amountCop, 0));
  return { currency: 'COP' as const, durationDays, amountCop, items };
}

// The caller locks the account and latest paid period before choosing this start.
export function renewalWindow(now: string | Date | number, paidThrough: string | Date | number | null, durationInput: unknown) {
  const durationDays = billingDuration(durationInput);
  const startsAt = Math.max(timestamp(now), paidThrough === null ? 0 : timestamp(paidThrough));
  const endsAt = startsAt + durationDays * BILLING_DAY_MS;
  if (!Number.isFinite(new Date(endsAt).getTime())) throw new ServiceError(400, 'Periodo invalido');
  return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
}

export type BillingPeriod = {
  startsAt: string;
  endsAt: string;
  modeSlugs: string[];
};
export type BillingOperation = 'read' | 'pay' | 'write' | 'launch' | 'capture' | 'compose' | 'print' | 'sync';
export type OperationalScope = { userId: string; accountId: string; deviceId: string; eventId: string; modeSlug: string };
export type LiveLaunch = OperationalScope & {
  sessionId: string;
  processId: string;
  startedAt: string;
  authorizedThrough: string;
  active: boolean;
};

// LiveLaunch must come from trusted process-local state, never restored storage or
// arbitrary request fields. Server handlers must independently validate its proof.
export function evaluateBillingAccess(input: {
  now: string | Date | number;
  membershipAllowed: boolean;
  administrativelyBlocked: boolean;
  periods: BillingPeriod[];
  operation: BillingOperation;
  scope: OperationalScope;
  processId?: string;
  targetSessionId?: string;
  liveLaunch?: LiveLaunch | null;
}) {
  const deny = (reason: string) => ({ allowed: false, reason, continuity: false });
  if (!input.membershipAllowed) return deny('ACCESS_REVOKED');
  if (input.administrativelyBlocked) return deny('ADMINISTRATIVE_BLOCK');
  if (input.operation === 'read' || input.operation === 'pay') return { allowed: true, reason: null, continuity: false };
  const now = timestamp(input.now);
  const current = input.periods.find(period => timestamp(period.startsAt) <= now && now < timestamp(period.endsAt));
  if (current) {
    if (!current.modeSlugs.includes(input.scope.modeSlug)) return deny('MODE_NOT_SUBSCRIBED');
    return { allowed: true, reason: null, continuity: false };
  }
  const live = input.liveLaunch;
  const canContinue = ['capture', 'compose', 'print', 'sync'].includes(input.operation);
  if (canContinue && live?.active && live.processId && live.processId === input.processId && live.sessionId === input.targetSessionId) {
    const matches = (['userId', 'accountId', 'deviceId', 'eventId', 'modeSlug'] as const)
      .every(key => live[key] === input.scope[key]);
    const start = timestamp(live.startedAt);
    const expiry = timestamp(live.authorizedThrough);
    if (matches && start <= now && start < expiry && now >= expiry) {
      return { allowed: true, reason: null, continuity: true };
    }
  }
  return deny('SUBSCRIPTION_EXPIRED');
}

export function assertTransferApproval(input: {
  status: string;
  expectedAmountCop: unknown;
  reportedAmountCop: unknown;
  receivedAmountCop: unknown;
  receivedConfirmed: boolean;
  bankReference: string;
}) {
  if (input.status !== 'pending_review') throw new ServiceError(409, 'El reporte ya fue resuelto o no esta listo para revision');
  if (input.receivedConfirmed !== true) throw new ServiceError(400, 'Confirma la recepcion del dinero');
  const expected = copAmount(input.expectedAmountCop);
  if (copAmount(input.reportedAmountCop) !== expected || copAmount(input.receivedAmountCop) !== expected) {
    throw new ServiceError(409, 'Resuelve la diferencia de importe antes de aprobar');
  }
  const bankReference = String(input.bankReference || '').trim();
  if (!bankReference || bankReference.length > 160) throw new ServiceError(400, 'Referencia bancaria requerida');
  return { bankReference, amountCop: expected };
}

export function expiryNotice(now: string | Date | number, endsAt: string | Date | number) {
  const remaining = timestamp(endsAt) - timestamp(now);
  if (remaining <= 0) return { kind: 'expired' as const, daysRemaining: 0 };
  if (remaining <= 7 * BILLING_DAY_MS) return { kind: 'expiring' as const, daysRemaining: Math.ceil(remaining / BILLING_DAY_MS) };
  return null;
}
