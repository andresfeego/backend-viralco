import { describe, expect, it } from 'vitest';
import { dailyBillingSlot, renewalNoticeAt, reportedPeriod, PROVISIONAL_REVIEW_MS } from '../src/domain/billing-renewals.ts';

describe('daily 09:00 Colombia billing calendar', () => {
  it.each([
    ['2026-10-06T13:59:59Z', '2026-10-05', '2026-10-06T14:00:00.000Z'],
    ['2026-10-06T14:00:00Z', '2026-10-06', '2026-10-07T14:00:00.000Z'],
    ['2026-10-07T03:00:00Z', '2026-10-06', '2026-10-07T14:00:00.000Z'],
    ['2027-01-01T13:00:00Z', '2026-12-31', '2027-01-01T14:00:00.000Z'],
  ])('recovers the last due slot at %s', (now, key, next) => {
    const slot = dailyBillingSlot(new Date(now));
    expect(slot.key).toBe(key);
    expect(slot.nextAt.toISOString()).toBe(next);
  });
  it('creates the notice five Colombian calendar days before expiration', () => {
    expect(renewalNoticeAt('2026-11-01T02:00:00Z').toISOString()).toBe('2026-10-26T14:00:00.000Z');
    expect(renewalNoticeAt('2026-11-01T18:00:00Z').toISOString()).toBe('2026-10-27T14:00:00.000Z');
  });
  it.each([30, 365])('anchors %s days at submission or the later paid end, never at approval', duration => {
    const submitted = new Date('2026-10-06T15:00:00Z');
    const first = reportedPeriod(submitted, null, duration);
    const expired = reportedPeriod(submitted, '2026-10-01T15:00:00Z', duration);
    const early = reportedPeriod(submitted, '2026-10-10T15:00:00Z', duration);
    expect(first).toEqual(expired);
    expect(first.startsAt).toBe(submitted.toISOString());
    expect(early.startsAt).toBe('2026-10-10T15:00:00.000Z');
    expect(new Date(early.endsAt).getTime() - new Date(early.startsAt).getTime()).toBe(duration * 86400000);
    expect(PROVISIONAL_REVIEW_MS).toBe(72 * 60 * 60 * 1000);
  });
});
