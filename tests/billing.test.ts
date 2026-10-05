import { describe, expect, it } from 'vitest';
import { assertTransferApproval, billingDuration, copAmount, evaluateBillingAccess, expiryNotice, quoteModes, renewalWindow, type CommercialMode, type LiveLaunch } from '../src/domain/billing.ts';

const catalog: CommercialMode[] = [
  { modeId: '1', slug: 'espejo', name: 'Espejo', available: true, implemented: true, prices: { 30: 50000, 365: 500000 } },
  { modeId: '2', slug: 'cabina', name: 'Cabina', available: true, implemented: true, prices: { 30: 20000, 365: 200000 } },
];
const scope = { userId: '1', accountId: '2', deviceId: 'phone', eventId: '3', modeSlug: 'espejo' };
const period = { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', modeSlugs: ['espejo'] };
const live: LiveLaunch = { ...scope, sessionId: 'launch', processId: 'process', active: true, startedAt: '2026-09-30T23:59:00.000Z', authorizedThrough: period.endsAt };
const base = { now: period.endsAt, membershipAllowed: true, administrativelyBlocked: false, periods: [period], operation: 'launch' as const, scope };

describe('manual subscription billing rules', () => {
  it.each([30, 365])('quotes independent COP prices for %s days', duration => {
    const quote = quoteModes(catalog, ['1', '2'], duration);
    expect(quote.amountCop).toBe(duration === 30 ? 70000 : 700000);
    expect(quote.currency).toBe('COP');
    expect(quote.durationDays).toBe(duration);
  });
  it.each([0, -1, 1.5, '50000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null])('rejects invalid money %s', value => {
    expect(() => copAmount(value)).toThrow();
  });
  it.each([31, 360, '30', null])('rejects unsupported durations %s', value => {
    expect(() => billingDuration(value)).toThrow();
  });
  it('rejects missing prices, unavailable and unimplemented modes', () => {
    for (const change of [{ prices: {} }, { available: false }, { implemented: false }]) {
      expect(() => quoteModes([{ ...catalog[0], ...change }], ['1'], 30)).toThrow();
    }
    expect(() => quoteModes(catalog, [], 30)).toThrow();
    expect(() => quoteModes(catalog, ['1', '1'], 30)).toThrow();
    expect(() => quoteModes(catalog, ['missing'], 30)).toThrow();
  });
  it('snapshots price/name independently from subsequent catalog edits', () => {
    const input = structuredClone(catalog);
    const quote = quoteModes(input, ['1'], 30);
    input[0].prices[30] = 99999;
    input[0].name = 'New';
    expect(quote.items[0]).toMatchObject({ amountCop: 50000, name: 'Espejo' });
  });
  it('rejects overflowing total', () => {
    expect(() => quoteModes(catalog.map(mode => ({ ...mode, prices: { 30: Number.MAX_SAFE_INTEGER } })), ['1', '2'], 30)).toThrow();
  });
  it('starts early renewal at paid expiry, overdue/first activation at approval', () => {
    const now = '2026-10-05T12:00:00.000Z';
    expect(renewalWindow(now, '2026-10-10T12:00:00.000Z', 30)).toEqual({ startsAt: '2026-10-10T12:00:00.000Z', endsAt: '2026-11-09T12:00:00.000Z' });
    for (const through of [null, period.endsAt]) expect(renewalWindow(now, through, 365)).toEqual({ startsAt: now, endsAt: '2027-10-05T12:00:00.000Z' });
  });
  it('uses exactly 365 days, not a calendar year across leap day', () => {
    expect(renewalWindow('2027-10-05T12:00:00Z', null, 365).endsAt).toBe('2028-10-04T12:00:00.000Z');
  });
  it('blocks exactly at expiry, but still permits read and payment', () => {
    expect(evaluateBillingAccess({ ...base, now: '2026-09-30T23:59:59.999Z' }).allowed).toBe(true);
    expect(evaluateBillingAccess(base).reason).toBe('SUBSCRIPTION_EXPIRED');
    for (const operation of ['read', 'pay'] as const) expect(evaluateBillingAccess({ ...base, operation }).allowed).toBe(true);
  });
  it('does not grant access from future paid periods or another mode', () => {
    expect(evaluateBillingAccess({ ...base, now: '2026-08-31T23:59:59Z' }).allowed).toBe(false);
    expect(evaluateBillingAccess({ ...base, now: period.startsAt, scope: { ...scope, modeSlug: 'cabina' } }).reason).toBe('MODE_NOT_SUBSCRIBED');
  });
  it.each(['capture', 'compose', 'print', 'sync'] as const)('continues %s only in the live process/session', operation => {
    const input = { ...base, operation, liveLaunch: live, processId: 'process', targetSessionId: 'launch' };
    expect(evaluateBillingAccess(input)).toEqual({ allowed: true, reason: null, continuity: true });
    expect(evaluateBillingAccess({ ...input, processId: 'new-process' }).allowed).toBe(false);
    expect(evaluateBillingAccess({ ...input, targetSessionId: 'old-pending' }).allowed).toBe(false);
    expect(evaluateBillingAccess({ ...input, liveLaunch: { ...live, active: false } }).allowed).toBe(false);
    expect(evaluateBillingAccess({ ...input, liveLaunch: { ...live, startedAt: period.endsAt } }).allowed).toBe(false);
  });
  it.each(['userId', 'accountId', 'deviceId', 'eventId', 'modeSlug'] as const)('does not extend continuity to another %s', key => {
    expect(evaluateBillingAccess({ ...base, operation: 'sync', liveLaunch: live, processId: 'process', targetSessionId: 'launch', scope: { ...scope, [key]: 'other' } }).allowed).toBe(false);
  });
  it('does not extend continuity to writes or new launches', () => {
    for (const operation of ['write', 'launch'] as const) expect(evaluateBillingAccess({ ...base, operation, liveLaunch: live, processId: 'process', targetSessionId: 'launch' }).allowed).toBe(false);
  });
  it('gives administrative blocks and revocations precedence over continuity', () => {
    const input = { ...base, operation: 'sync' as const, liveLaunch: live, processId: 'process', targetSessionId: 'launch' };
    expect(evaluateBillingAccess({ ...input, administrativelyBlocked: true }).reason).toBe('ADMINISTRATIVE_BLOCK');
    expect(evaluateBillingAccess({ ...input, membershipAllowed: false }).reason).toBe('ACCESS_REVOKED');
  });
  it('requires exact reported/received amounts and explicit confirmation', () => {
    const approval = { status: 'pending_review', expectedAmountCop: 50000, reportedAmountCop: 50000, receivedAmountCop: 50000, receivedConfirmed: true, bankReference: ' BANK-123 ' };
    expect(assertTransferApproval(approval)).toEqual({ bankReference: 'BANK-123', amountCop: 50000 });
    for (const change of [{ receivedConfirmed: false }, { receivedAmountCop: 49999 }, { receivedAmountCop: 50001 }, { reportedAmountCop: 40000 }, { bankReference: '' }, { status: 'approved' }, { status: 'rejected' }]) {
      expect(() => assertTransferApproval({ ...approval, ...change })).toThrow();
    }
  });
  it('notifies from seven days before expiry and never grants grace', () => {
    expect(expiryNotice('2026-09-23T23:59:59Z', period.endsAt)).toBeNull();
    expect(expiryNotice('2026-09-24T00:00:00Z', period.endsAt)).toEqual({ kind: 'expiring', daysRemaining: 7 });
    expect(expiryNotice(period.endsAt, period.endsAt)).toEqual({ kind: 'expired', daysRemaining: 0 });
  });
});
