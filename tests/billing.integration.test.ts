import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/billing-receipt-storage.ts', () => ({
  storeBillingReceipt: async (account: string, file: any) => ({ key: `receipts/${account}/${randomUUID()}`, sha256: file.hash || randomUUID(), contentType: 'application/pdf', sizeBytes: 10 }),
  signAuthorizedBillingReceipt: async () => ({ url: 'https://private.test/signed' }),
}));
import { billingDb as db } from '../src/db/billing.ts';
import { accountBilling, billingState, cancelBillingOrder, createBillingOrder, listTransferReports, receiptLink, reviewTransfer, saveBillingCatalog, submitTransfer } from '../src/services/billing.service.ts';
import { createBankOption } from '../src/services/billing-bank.service.ts';
import { catalogModeImpact, removeCatalogMode, restoreCatalogMode } from '../src/services/billing-catalog-lifecycle.service.ts';

const run = process.env.RUN_BILLING_DB_TESTS === '1' ? describe : describe.skip;
run('billing isolated database transactions', () => {
  let admin: any; let account: string; let mode: string; let other: string; let bank: any;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'viralco_billing_test') throw new Error('Billing tests require the isolated viralco_billing_test database');
    const now = new Date(); const suffix = randomUUID().slice(0, 8);
    await db('user_statuses').insert({ slug: 'active', name: 'Active' }).onConflict('slug').ignore();
    const status = await db('user_statuses').where({ slug: 'active' }).first();
    const [userId] = await db('users').insert({ email: `${suffix}@billing.test`, password: 'not-a-login', name: 'Billing Test', status_id: status.id, created_at: now, updated_at: now });
    admin = { id: String(userId), globalRoles: [{ slug: 'super_admin' }] };
    const [accountId] = await db('accounts').insert({ slug: `billing_${suffix}`, name: 'Billing Test', owner_user_id: userId, status: 'active', created_at: now, updated_at: now }); account = String(accountId);
    const [otherId] = await db('accounts').insert({ slug: `other_${suffix}`, name: 'Other', owner_user_id: userId, status: 'active', created_at: now, updated_at: now }); other = String(otherId);
    await db('modes').insert({ slug: 'espejo', name: 'Espejo', is_default: true }).onConflict('slug').ignore();
    const row = await db('modes').where({ slug: 'espejo' }).first(); mode = String(row.id);
    await db('billing_catalog').insert({ mode_id: mode, name: 'Espejo', features: '[]' }).onConflict('mode_id').ignore();
    await saveBillingCatalog(mode, { name: 'Espejo', description: '', features: [], order: 0, available: true, prices: { 30: 50000, 365: 500000 } }, admin);
    bank = await createBankOption({ bank: 'Test bank', holder: 'Test', identification: '123', accountType: 'Savings', accountNumber: '1234', instructions: '', active: true }, admin);
  });
  afterAll(async () => { await db.destroy(); });
  const order = (durationDays = 30) => createBillingOrder(account, { modeIds: [mode], durationDays, bankId: bank.id }, admin);
  const report = async (o: any, amount = o.amountCop) => submitTransfer(account, o.id, { amountCop: amount, reference: randomUUID(), transferDate: new Date().toISOString().slice(0, 10) }, {}, admin);
  const approve = (r: any, amount = 50000) => reviewTransfer(r.id, { decision: 'approved', receivedConfirmed: true, receivedAmountCop: amount, bankReference: randomUUID(), duplicatesAcknowledged: true }, admin);

  it('starts unpaid without affecting another account', async () => {
    expect((await billingState(account)).active).toBe(false);
    expect((await billingState(other)).active).toBe(false);
  });
  it('enforces one open order under concurrency and cancellation', async () => {
    const results = await Promise.allSettled([order(), order()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const created: any = results.find(r => r.status === 'fulfilled');
    await cancelBillingOrder(account, created.value.id, admin);
  });
  it('keeps snapshot prices and bank details; rejects duplicate approval', async () => {
    const o = await order();
    await saveBillingCatalog(mode, { name: 'New name', description: '', features: [], order: 0, available: true, prices: { 30: 60000, 365: 600000 } }, admin);
    const details = await accountBilling(account, admin);
    expect(details.orders[0].amountCop).toBe(50000);
    expect(details.orders[0].snapshot.items[0].name).toBe('Espejo');
    const r = await report(o);
    await removeCatalogMode(mode, await catalogModeImpact(mode, admin), admin);
    const results = await Promise.allSettled([approve(r), approve(r)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect((await db('billing_periods').where({ order_id: o.id })).length).toBe(1);
    expect((await billingState(account)).active).toBe(true);
    expect((await billingState(other)).active).toBe(false);
    await expect(order()).rejects.toThrow('Servicio no disponible');
    await restoreCatalogMode(mode, admin);
    await expect(order()).rejects.toThrow('Servicio no disponible');
    await saveBillingCatalog(mode, { name: 'New name', description: '', features: [], order: 0, available: true, prices: { 30: 60000, 365: 600000 } }, admin);
  });
  it('renews early from the paid end and uses exactly 365 days', async () => {
    const previous = (await billingState(account)).periods.at(-1)!;
    const o = await order(365); const r = await report(o); const result: any = await approve(r, 600000);
    expect(result.period.startsAt).toBe(previous.endsAt);
    expect(new Date(result.period.endsAt).getTime() - new Date(result.period.startsAt).getTime()).toBe(365 * 86400000);
    expect((await billingState(account)).current?.orderId).not.toBe(o.id);
  });
  it('keeps rejected report history and accepts a corrected report', async () => {
    const o = await order(); const r = await report(o, 1);
    await expect(approve(r, 60000)).rejects.toMatchObject({ status: 409 });
    await expect(reviewTransfer(r.id, { decision: 'rejected', reason: '' }, admin)).rejects.toMatchObject({ status: 400 });
    await reviewTransfer(r.id, { decision: 'rejected', reason: 'Wrong amount' }, admin);
    const corrected = await report(o);
    await approve(corrected, 60000);
    expect((await accountBilling(account, admin)).reports.filter(rp => rp.orderId === o.id)).toHaveLength(2);
  });
  it('requires superadmin review and protects receipt access', async () => {
    const reports = await listTransferReports({ status: 'approved' }, admin);
    await expect(reviewTransfer(reports[0].id, { decision: 'approved' }, { id: '999999' })).rejects.toMatchObject({ status: 403 });
    await expect(receiptLink(reports[0].id, { id: '999999' })).rejects.toMatchObject({ status: 403 });
  });
  it('administrative suspension prevails over paid entitlement', async () => {
    await db('accounts').where({ id: account }).update({ status: 'suspended' });
    expect((await billingState(account)).active).toBe(false);
    expect((await billingState(account)).administrativelyBlocked).toBe(true);
  });
});
