import { BILLING_DAY_MS, renewalWindow } from './billing.ts';

export const PROVISIONAL_REVIEW_MS = 3 * BILLING_DAY_MS;
export const BILLING_TIME_ZONE = 'America/Bogota';
const colombiaDate = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: BILLING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// Colombia's 09:00 is 14:00 UTC. Date calculations never use the host timezone.
export function dailyBillingSlot(now = new Date()) {
  const today = new Date(`${colombiaDate(now)}T14:00:00.000Z`);
  const due = now >= today ? today : new Date(today.getTime() - BILLING_DAY_MS);
  return { key: colombiaDate(due), scheduledAt: due, nextAt: new Date(due.getTime() + BILLING_DAY_MS) };
}

export function renewalNoticeAt(endsAt: string | Date) {
  const localDate = colombiaDate(new Date(endsAt));
  return new Date(new Date(`${localDate}T14:00:00.000Z`).getTime() - 5 * BILLING_DAY_MS);
}

export function reportedPeriod(submittedAt: Date, paidThrough: string | Date | null, durationDays: number) {
  return renewalWindow(submittedAt, paidThrough, durationDays);
}
