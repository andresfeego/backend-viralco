import { billingDb as db } from '../db/billing.ts';
import { dailyBillingSlot, renewalNoticeAt } from '../domain/billing-renewals.ts';
import { insertContractRenewal } from './billing-contract.service.ts';
import { ServiceError } from '../lib/service-error.ts';
import { technicalErrorDetail, writeTechnicalErrorLog } from '../lib/technical-error-log.ts';

export async function runDailyBillingRenewals(now = new Date()) {
  const slot = dailyBillingSlot(now);
  return db.transaction(async tx => {
    await tx('billing_daily_runs').insert({ scheduled_for: slot.key }).onConflict('scheduled_for').ignore();
    const run = await tx('billing_daily_runs').where({ scheduled_for: slot.key }).forUpdate().first();
    if (run.completed_at) return { created: 0, alreadyCompleted: true };
    // Match the catalog retirement/order lock order, including across replicas.
    await tx('modes').select('id').orderBy('id').forUpdate();
    const accounts = await tx('accounts as a').join('billing_contracts as c', 'c.account_id', 'a.id').where({ 'a.status': 'active', 'a.is_system': false }).select('a.*').orderBy('a.id');
    let created = 0;
    for (const account of accounts) {
      await tx('accounts').where({ id: account.id }).forUpdate().first();
      const sub = await tx('subscriptions').where({ account_id: account.id }).orderBy('starts_at', 'desc').orderBy('id', 'desc').first();
      if (['suspended', 'canceled'].includes(sub?.status)) continue;
      const last = await tx('billing_periods').where({ account_id: account.id }).orderBy('ends_at', 'desc').first();
      // No new cycle until an actual period exists; unpaid accounts do not accrue debt.
      if (!last || renewalNoticeAt(last.ends_at) > slot.scheduledAt) continue;
      try {
        const result = await insertContractRenewal(tx, account, now);
        if (result.created) created += 1;
      } catch (error) {
        if (!(error instanceof ServiceError) || error.status !== 409) throw error;
        // Archived/unavailable services cannot be sold by an automatic renewal.
      }
    }
    await tx('billing_daily_runs').where({ scheduled_for: slot.key }).update({ completed_at: now });
    return { created, alreadyCompleted: false };
  });
}

export function startBillingRenewalSchedule() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const execute = async () => {
    try { await runDailyBillingRenewals(); }
    catch (error) {
      await writeTechnicalErrorLog({ requestId: 'billing-daily-renewal', code: 'BILLING_RENEWAL_JOB_FAILED', status: 500, path: 'billing/renewals', detail: technicalErrorDetail(error) }).catch(() => {});
    } finally {
      if (!stopped) {
        timer = setTimeout(execute, Math.max(1, dailyBillingSlot().nextAt.getTime() - Date.now()));
        timer.unref();
      }
    }
  };
  // Recover a missed 09:00 execution after downtime, not one job per account.
  void execute();
  return () => { stopped = true; clearTimeout(timer); };
}
