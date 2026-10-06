import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/billing-receipt-storage.ts', () => ({
  storeBillingReceipt: async () => ({ key: randomUUID(), sha256: randomUUID(), contentType: 'application/pdf', sizeBytes: 10 }),
  signAuthorizedBillingReceipt: async () => ({ url: 'https://private.test/signed' }),
}));
import { billingDb as db } from '../src/db/billing.ts';
import { accountBilling, billingState, cancelBillingOrder, createBillingOrder, listTransferReports, receiptLink, reviewTransfer, saveBillingCatalog, submitTransfer } from '../src/services/billing.service.ts';
import { createSelfServiceAccount } from '../src/services/accounts.service.ts';
import { runDailyBillingRenewals } from '../src/services/billing-renewal-job.ts';
import { PROVISIONAL_REVIEW_MS, renewalNoticeAt } from '../src/domain/billing-renewals.ts';
import { catalogModeImpact, removeCatalogMode, restoreCatalogMode } from '../src/services/billing-catalog-lifecycle.service.ts';
import pendingReportMigration from '../migrations/20261006110000_billing_pending_report_dates.cjs';

const run = process.env.RUN_BILLING_DB_TESTS === '1' ? describe : describe.skip;
run('fixed subscription and payment lifecycle in isolated database', () => {
  let admin: any, mode: string;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'viralco_billing_test') throw new Error('Isolated billing database required');
    await db('user_statuses').insert({ slug: 'active', name: 'Active' }).onConflict('slug').ignore();
    const status = await db('user_statuses').where({ slug: 'active' }).first();
    const [userId] = await db('users').insert({ email: randomUUID() + '@billing.test', password: randomUUID(), name: 'Billing Test', status_id: status.id, created_at: new Date(), updated_at: new Date() });
    admin = { id: String(userId), globalRoles: [{ slug: 'super_admin' }] };
    await db('modes').insert({ slug: 'espejo', name: 'Espejo', is_default: true }).onConflict('slug').ignore();
    mode = String((await db('modes').where({ slug: 'espejo' }).first()).id);
    await db('billing_catalog').insert({ mode_id: mode, name: 'Espejo', features: '[]' }).onConflict('mode_id').ignore();
    await db('billing_catalog').where({ mode_id: mode }).update({ archived_at: null, archived_by: null });
    await configure(50000, 500000);
  });
  afterAll(() => db.destroy());
  const configure = (monthly: number, annual: number) => saveBillingCatalog(mode, { name: 'Espejo', description: '', features: [], order: 0, available: true, prices: { 30: monthly, 365: annual } }, admin);
  async function signup(durationDays = 30) {
    const account = await createSelfServiceAccount({ name: 'Contract Test', slug: 'contract_' + randomUUID().replaceAll('-', ''), modeSlugs: ['espejo'], durationDays }, admin);
    const details = await accountBilling(account.id, admin);
    return { account: account.id, details, order: details.orders[0] };
  }
  const report = (f: any, o = f.order, amount = o.amountCop) => submitTransfer(f.account, o.id, { amountCop: amount, reference: randomUUID(), transferDate: new Date().toISOString().slice(0, 10) }, {}, admin);
  const approve = (r: any, amount: number) => reviewTransfer(r.id, { decision: 'approved', receivedConfirmed: true, receivedAmountCop: amount, bankReference: randomUUID(), duplicatesAcknowledged: true }, admin);

  it.each([30, 365])('atomically creates the account, fixed %s-day contract and first unpaid receipt', async days => {
    const f = await signup(days);
    expect(f.details.active).toBe(false);
    expect(f.details.contract).toMatchObject({ durationDays: days, amountCop: days === 30 ? 50000 : 500000 });
    expect(f.details.orders).toHaveLength(1);
    expect(f.order.status).toBe('awaiting_payment');
    expect(f.order.snapshot.bank).toBeUndefined();
    await expect(cancelBillingOrder(f.account, f.order.id, admin)).rejects.toMatchObject({ status: 409 });
    await expect(createBillingOrder(f.account, { durationDays: days === 30 ? 365 : 30 }, admin)).rejects.toMatchObject({ status: 409 });
  });
  it('rolls creation back when COP tariffs are unavailable', async () => {
    const slug = 'invalid_' + randomUUID().replaceAll('-', '');
    await db('billing_catalog').where({ mode_id: mode }).update({ available: false });
    await expect(createSelfServiceAccount({ name: 'Invalid', slug, modeSlugs: ['espejo'], durationDays: 30 }, admin)).rejects.toMatchObject({ status: 409 });
    expect(await db('accounts').where({ slug }).first()).toBeUndefined();
    await configure(50000, 500000);
  });
  it('accepts receipts without a transfer number and does not treat blank references as duplicates', async () => {
    const first = await signup(), second = await signup();
    const input = { amountCop: 50000, transferDate: new Date().toISOString().slice(0, 10) };
    const a = await submitTransfer(first.account, first.order.id, input, {}, admin);
    const b = await submitTransfer(second.account, second.order.id, input, {}, admin);
    const reports = await listTransferReports({}, admin);
    for (const r of [a, b]) expect(reports.find(row => row.id === r.id)).toMatchObject({ reference: '', duplicateCount: 0 });
    await reviewTransfer(a.id, { decision: 'approved', receivedConfirmed: true, receivedAmountCop: 50000, bankReference: randomUUID() }, admin);
    // Removing the form field must not disable detection of repeated files.
    const source = await db('billing_reports').where({ id: a.id }).first();
    await db('billing_reports').where({ id: b.id }).update({ receipt_sha256: source.receipt_sha256 });
    expect((await listTransferReports({}, admin)).find(row => row.id === b.id)?.duplicateCount).toBeGreaterThan(0);
    await expect(reviewTransfer(b.id, { decision: 'approved', receivedConfirmed: true, receivedAmountCop: 50000, bankReference: randomUUID() }, admin)).rejects.toMatchObject({ status: 409 });
  });
  it('grants exactly 72 hours, rejects mismatched amounts and never restarts provisional access', async () => {
    const f = await signup();
    await expect(report(f, f.order, 1)).rejects.toMatchObject({ status: 409 });
    const r = await report(f);
    expect(new Date(r.provisionalUntil).getTime() - new Date(r.period.startsAt).getTime()).toBe(PROVISIONAL_REVIEW_MS);
    expect((await billingState(f.account)).current?.source).toBe('provisional');
    expect((await billingState(f.account, db, new Date(r.provisionalUntil))).active).toBe(false);
    await expect(reviewTransfer(r.id, { decision: 'rejected', reason: '' }, admin)).rejects.toMatchObject({ status: 400 });
    await reviewTransfer(r.id, { decision: 'rejected', reason: 'No transfer received' }, admin);
    expect((await billingState(f.account)).active).toBe(false);
    const next = await report(f);
    expect(next.provisionalUntil).toBe(r.provisionalUntil);
    expect((await accountBilling(f.account, admin)).reports).toHaveLength(2);
  });
  it.each(['approved', 'rejected'])('persists optional observations independently for %s reviews', async decision => {
    const f = await signup(); const r = await report(f);
    const payload = { decision, observations: '  Nota interna de conciliacion  ', reason: 'Transferencia no recibida', receivedConfirmed: true, receivedAmountCop: 50000, bankReference: randomUUID() };
    await reviewTransfer(r.id, payload, admin);
    const saved = await db('billing_reviews').where({ report_id: r.id }).first();
    expect(saved.observations).toBe('Nota interna de conciliacion');
    expect(saved.reason).toBe(decision === 'rejected' ? payload.reason : null);
    expect((await listTransferReports({ status: decision }, admin)).find(row => row.id === r.id)?.observations).toBe('Nota interna de conciliacion');
    expect((await accountBilling(f.account, admin)).reports.find(row => row.id === r.id)).not.toHaveProperty('observations');
    await expect(reviewTransfer(r.id, { ...payload, observations: 'Overwrite' }, admin)).rejects.toMatchObject({ status: 409 });
    expect((await db('billing_reviews').where({ report_id: r.id }).first()).observations).toBe('Nota interna de conciliacion');
  });
  it('rejects malformed observations without changing payment state or bypassing approval requirements', async () => {
    const f = await signup(); const r = await report(f);
    const payload = { decision: 'approved', receivedConfirmed: true, receivedAmountCop: 50000, bankReference: randomUUID() };
    for (const observations of ['X'.repeat(2001), 42, { text: 'not a string' }]) {
      await expect(reviewTransfer(r.id, { ...payload, observations }, admin)).rejects.toMatchObject({ status: 400 });
    }
    await expect(reviewTransfer(r.id, { ...payload, receivedConfirmed: false, observations: 'Confirmed in notes only' }, admin)).rejects.toMatchObject({ status: 400 });
    await expect(reviewTransfer(r.id, { ...payload, bankReference: '', observations: 'No reference' }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await db('billing_reviews').where({ report_id: r.id })).toHaveLength(0);
    expect((await db('billing_reports').where({ id: r.id }).first()).status).toBe('pending_review');
    await reviewTransfer(r.id, { ...payload, observations: '   ' }, admin);
    expect((await db('billing_reviews').where({ report_id: r.id }).first()).observations).toBeNull();
  });
  it('freezes prices and submission dates; concurrent verification grants only one period', async () => {
    const f = await signup(); const r = await report(f);
    await configure(60000, 600000);
    expect((await accountBilling(f.account, admin)).contract?.amountCop).toBe(50000);
    await removeCatalogMode(mode, await catalogModeImpact(mode, admin), admin);
    const results = await Promise.allSettled([approve(r, 50000), approve(r, 50000)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const periods = await db('billing_periods').where({ order_id: f.order.id });
    expect(periods).toHaveLength(1);
    expect(new Date(periods[0].starts_at).toISOString()).toBe(r.period.startsAt);
    expect(new Date(periods[0].ends_at).toISOString()).toBe(r.period.endsAt);
    await expect(createBillingOrder(f.account, {}, admin)).rejects.toThrow('Servicio no disponible');
    await restoreCatalogMode(mode, admin); await configure(50000, 500000);
  });
  it.each([30, 365])('creates a single renewal at 09:00 and preserves early/late %s-day periods', async duration => {
    const f = await signup(duration); const r = await report(f); await approve(r, f.order.amountCop);
    const period = await db('billing_periods').where({ order_id: f.order.id }).first();
    const expiry = new Date(Date.UTC(2027, 0, Number(period.id) + 1, 18));
    await db('billing_periods').where({ id: period.id }).update({ ends_at: expiry });
    const scheduled = renewalNoticeAt(expiry);
    await runDailyBillingRenewals(new Date(scheduled.getTime() - 1));
    expect(await db('billing_orders').where({ renewal_period_id: period.id })).toHaveLength(0);
    await Promise.all([runDailyBillingRenewals(scheduled), runDailyBillingRenewals(scheduled)]);
    const rows = await db('billing_orders').where({ renewal_period_id: period.id });
    expect(rows).toHaveLength(1);
    expect(await db('billing_notices').where({ order_id: rows[0].id })).toHaveLength(1);
    expect((await runDailyBillingRenewals(scheduled)).alreadyCompleted).toBe(true);
    const renewal = (await accountBilling(f.account, admin)).orders[0];
    const early = await report(f, renewal);
    expect(early.period.startsAt).toBe(expiry.toISOString());
    await reviewTransfer(early.id, { decision: 'rejected', reason: 'Test rejected renewal' }, admin);
    expect((await billingState(f.account)).active).toBe(true);
    await db('billing_periods').where({ id: period.id }).update({ ends_at: new Date(Date.now() - 86400000) });
    const late = await report(f, renewal);
    expect(new Date(late.period.startsAt).getTime()).toBeGreaterThan(Date.now() - 10000);
    expect(new Date(late.period.endsAt).getTime() - new Date(late.period.startsAt).getTime()).toBe(duration * 86400000);
    await approve(late, f.order.amountCop);
  });
  it('protects private receipts and never lifts administrative suspensions', async () => {
    const f = await signup(); const r = await report(f);
    await expect(receiptLink(r.id, { id: '999999' })).rejects.toMatchObject({ status: 403 });
    const link = await receiptLink(r.id, admin);
    expect(link).toMatchObject({ url: 'https://private.test/signed', contentType: 'application/pdf', sizeBytes: 10, sha256: expect.any(String) });
    expect(link).not.toHaveProperty('receipt_key');
    await expect(reviewTransfer(r.id, { decision: 'approved' }, { id: admin.id, globalRoles: [] })).rejects.toMatchObject({ status: 403 });
    await db('accounts').where({ id: f.account }).update({ status: 'suspended' });
    expect((await billingState(f.account)).active).toBe(false);
    await approve(r, f.order.amountCop);
    expect((await billingState(f.account)).administrativelyBlocked).toBe(true);
  });
  it('adopts a legacy pending report without restarting its review window', async () => {
    const f = await signup(); const r = await report(f);
    const originalDate = new Date(Date.now() - 4 * 86400000);
    await db('billing_reports').where({ id: r.id }).update({ created_at: originalDate, period_starts_at: null, period_ends_at: null });
    await db('billing_orders').where({ id: f.order.id }).update({ provisional_until: null });
    await pendingReportMigration.up(db);
    const before = await db('billing_orders').where({ id: f.order.id }).first();
    const historicalReport = await db('billing_reports').where({ id: r.id }).first();
    expect(new Date(before.provisional_until).getTime() - new Date(historicalReport.created_at).getTime()).toBe(PROVISIONAL_REVIEW_MS);
    expect((await billingState(f.account)).active).toBe(false);
    await pendingReportMigration.up(db);
    expect((await db('billing_orders').where({ id: f.order.id }).first()).provisional_until).toEqual(before.provisional_until);
    await approve(r, f.order.amountCop);
    expect(new Date((await billingState(f.account)).current.startsAt).getTime()).toBe(new Date(historicalReport.created_at).getTime());
  });
});
