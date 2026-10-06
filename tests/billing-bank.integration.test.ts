import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { billingDb as db } from '../src/db/billing.ts';
import { createBankOption, listBankOptions, updateBankOption, selectTransferBank, saveBankSettings } from '../src/services/billing-bank.service.ts';
import { accountBilling, cancelBillingOrder, saveBillingCatalog } from '../src/services/billing.service.ts';

const suite = process.env.RUN_BILLING_DB_TESTS === '1' ? describe : describe.skip;
const details = { bank: 'Synthetic bank', holder: 'Test holder', identification: '001', accountType: 'Savings', accountNumber: '000123', instructions: 'Only test data', active: true };
suite('multiple transfer destinations in isolated database', () => {
  let admin: any, account: string, mode: string, first: any, second: any;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'viralco_billing_test') throw new Error('Isolated database required');
    const status = await db('user_statuses').where({ slug: 'active' }).first();
    const [userId] = await db('users').insert({ email: `${randomUUID()}@banks.test`, password: 'test-only', name: 'Bank test', status_id: status.id, created_at: new Date(), updated_at: new Date() });
    admin = { id: String(userId), globalRoles: [{ slug: 'super_admin' }] };
    const [accountId] = await db('accounts').insert({ slug: `bank_${randomUUID()}`, name: 'Bank test', owner_user_id: userId, status: 'active', created_at: new Date(), updated_at: new Date() }); account = String(accountId);
    mode = String((await db('modes').where({ slug: 'espejo' }).first()).id);
    await db('billing_catalog').where({ mode_id: mode }).update({ archived_at: null, archived_by: null });
    await saveBillingCatalog(mode, { name: 'Espejo', description: '', features: [], order: 0, available: true, prices: { 30: 50000, 365: 500000 } }, admin);
    first = await createBankOption(details, admin);
    second = await createBankOption({ ...details, bank: 'Second bank', accountNumber: '000456', active: false }, admin);
  });
  afterAll(() => db.destroy());
  // Historical orders selected a bank; new fixed-contract receipts do not.
  const order = (bankId: string) => db.transaction(async tx => {
    const bank = await selectTransferBank(tx, bankId);
    const snapshot = { currency: 'COP', durationDays: 30, amountCop: 50000, items: [{ modeId: mode, slug: 'espejo', name: 'Espejo', amountCop: 50000 }], bank };
    const [id] = await tx('billing_orders').insert({ account_id: account, open_account_id: account, status: 'awaiting_payment', duration_days: 30, amount_cop: 50000, snapshot: JSON.stringify(snapshot), created_by: admin.id });
    return { id: String(id), snapshot };
  });
  it('persists independent active/inactive options and only exposes active options to the customer', async () => {
    const all = await listBankOptions();
    expect(all.find(item => item.id === first.id)).toMatchObject({ ...details, id: first.id, revision: 1 });
    expect(all.find(item => item.id === second.id)?.active).toBe(false);
    const customer = await accountBilling(account, admin);
    expect(customer.banks.some(item => item.id === first.id)).toBe(true);
    expect(customer.banks.some(item => item.id === second.id)).toBe(false);
    await expect(order(second.id)).rejects.toThrow('BANK_OPTION_UNAVAILABLE');
  });
  it('preserves existing order snapshots when editing or disabling the chosen option', async () => {
    const original = await order(first.id);
    first = await updateBankOption(first.id, { ...first, bank: 'New bank name', accountNumber: '999', active: false }, admin);
    const reopened = (await accountBilling(account, admin)).orders.find(item => item.id === original.id)!;
    expect(reopened.snapshot.bank).toMatchObject({ bank: details.bank, accountNumber: '000123', id: first.id });
    expect(reopened.snapshot).toEqual(original.snapshot);
    await cancelBillingOrder(account, original.id, admin);
    await expect(order(first.id)).rejects.toThrow('BANK_OPTION_UNAVAILABLE');
    second = await updateBankOption(second.id, { active: true, revision: second.revision }, admin, true);
    const next = await order(second.id);
    expect(next.snapshot.bank).toMatchObject({ id: second.id, accountNumber: '000456' });
    await cancelBillingOrder(account, next.id, admin);
  });
  it('rejects stale edits and ordinary users, validates booleans, and audits changes', async () => {
    await expect(updateBankOption(second.id, { ...second, revision: 1 }, admin)).rejects.toThrow('BANK_OPTION_CHANGED');
    await expect(updateBankOption(second.id, { active: 'false', revision: second.revision }, admin, true)).rejects.toMatchObject({ status: 400 });
    await expect(createBankOption(details, { id: admin.id, globalRoles: [] })).rejects.toMatchObject({ status: 403 });
    await expect(updateBankOption(second.id, second, { id: admin.id, globalRoles: [] })).rejects.toMatchObject({ status: 403 });
    expect(await db('bitacora').where({ accion: 'billing.bank.activate', entidad_id: second.id }).first()).toBeTruthy();
    await expect(saveBankSettings(details, admin)).rejects.toMatchObject({ status: 409 });
  });
  it('serializes selection behind a concurrent deactivation', async () => {
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const writer = db.transaction(async tx => {
      await tx('billing_bank_options').where({ id: second.id }).forUpdate().first();
      locked(); await proceed;
      await tx('billing_bank_options').where({ id: second.id }).update({ active: false });
    });
    await ready;
    const selection = db.transaction(tx => selectTransferBank(tx, second.id));
    const assertion = expect(selection).rejects.toThrow('BANK_OPTION_UNAVAILABLE');
    release(); await writer; await assertion;
  });
});
