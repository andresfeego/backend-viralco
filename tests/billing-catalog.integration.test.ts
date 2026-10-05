import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { billingDb as db } from '../src/db/billing.ts';
import { catalogModeImpact, removeCatalogMode, restoreCatalogMode } from '../src/services/billing-catalog-lifecycle.service.ts';
import { listBillingCatalog, saveBillingCatalog } from '../src/services/billing.service.ts';

const suite = process.env.RUN_BILLING_DB_TESTS === '1' ? describe : describe.skip;
suite('catalog lifecycle in isolated database', () => {
  let user: any; let account: any; let plan: any;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'viralco_billing_test') throw new Error('Isolated database required');
    const status = await db('user_statuses').where({ slug: 'active' }).first();
    const [id] = await db('users').insert({ email: `${randomUUID()}@catalog.test`, password: 'test-only', name: 'Catalog test', status_id: status.id, created_at: new Date(), updated_at: new Date() });
    user = { id: String(id), globalRoles: [{ slug: 'super_admin' }] };
    [account] = await db('accounts').insert({ slug: `test_${randomUUID()}`, name: 'Lifecycle Test', owner_user_id: id, status: 'active', created_at: new Date(), updated_at: new Date() });
    plan = await db('subscription_plans').first();
  });
  afterAll(async () => { await db.destroy(); });
  async function mode() {
    const slug = `draft-${randomUUID()}`;
    const [id] = await db('modes').insert({ slug, name: 'Draft', is_default: false });
    await db('billing_catalog').insert({ mode_id: id, name: 'Draft', available: false, features: '[]', price_30_cop: 100, price_365_cop: 1000 });
    return { id: String(id), slug };
  }
  async function order(m: any, status = 'canceled') {
    const [id] = await db('billing_orders').insert({ account_id: account, status, duration_days: 30, amount_cop: 100, snapshot: JSON.stringify({ items: [{ modeId: m.id, slug: m.slug }], bank: {} }), created_by: user.id });
    return id;
  }
  it('deletes an unused priced mode and audits it; rejects non-superadmin', async () => {
    const m = await mode();
    await expect(catalogModeImpact(m.id, { id: user.id, globalRoles: [] })).rejects.toThrow('Super Admin');
    const impact = await catalogModeImpact(m.id, user);
    expect(impact.action).toBe('delete');
    await expect(removeCatalogMode(m.id, impact, { id: user.id, globalRoles: [] })).rejects.toThrow('Super Admin');
    await removeCatalogMode(m.id, impact, user);
    expect(await db('modes').where({ id: m.id }).first()).toBeUndefined();
    expect(await db('billing_catalog').where({ mode_id: m.id }).first()).toBeUndefined();
    expect(await db('bitacora').where({ entidad_id: m.id, accion: 'billing.catalog.delete' }).first()).toBeTruthy();
  });
  it('requires fresh confirmation if an order appeared after the preview', async () => {
    const m = await mode(); const initial = await catalogModeImpact(m.id, user);
    await order(m);
    await expect(removeCatalogMode(m.id, initial, user)).rejects.toThrow('CATALOG_IMPACT_CHANGED');
    const current = await catalogModeImpact(m.id, user);
    expect(current.action).toBe('archive'); expect(current.usage.orders).toBe(1);
    await removeCatalogMode(m.id, current, user);
    expect((await listBillingCatalog()).some(item => item.modeId === m.id)).toBe(false);
    expect((await listBillingCatalog(db, true)).some(item => item.modeId === m.id)).toBe(true);
    await expect(saveBillingCatalog(m.id, { name: 'Draft', description: '', features: [], order: 0, available: false, prices: { 30: 100, 365: 1000 } }, user)).rejects.toThrow('Restaura');
    await expect(restoreCatalogMode(m.id, { id: user.id, globalRoles: [] })).rejects.toThrow('Super Admin');
    await restoreCatalogMode(m.id, user);
    const restored = (await listBillingCatalog()).find(item => item.modeId === m.id);
    expect(restored).toMatchObject({ available: false, archivedAt: null, prices: { 30: 100, 365: 1000 } });
  });
  it.each(['preference', 'subscription', 'period', 'event'])('archives a mode referenced only by %s', async kind => {
    const m = await mode();
    if (kind === 'preference' || kind === 'subscription') {
      const [sub] = await db('subscriptions').insert({ account_id: account, plan_id: plan.id, status: 'past_due', starts_at: new Date(), metadata: JSON.stringify({ billingPreference: { modeSlugs: kind === 'preference' ? [m.slug] : [] } }) });
      if (kind === 'subscription') await db('subscription_modes').insert({ subscription_id: sub, mode_id: m.id, price_amount: 0, price_currency: 'COP', status: 'active' });
    } else if (kind === 'period') {
      await db('billing_periods').insert({ account_id: account, source: 'test', services: JSON.stringify([{ modeId: Number(m.id) }]), starts_at: new Date(), ends_at: new Date(Date.now() + 10000) });
    } else {
      const type = await db('event_types').first();
      const [event] = await db('events').insert({ account_id: account, event_type_id: type.id, name: 'Test', slug: randomUUID(), status: 'draft', timezone: 'America/Bogota', created_by: user.id });
      await db('event_modes').insert({ event_id: event, mode_id: m.id, is_active: true, order_index: 0 });
    }
    const impact = await catalogModeImpact(m.id, user); expect(impact.action).toBe('archive');
    await removeCatalogMode(m.id, impact, user);
    expect(await db('modes').where({ id: m.id }).first()).toBeTruthy();
  });
  it('serializes removal with a new JSON-only order reference', async () => {
    const m = await mode(); const initial = await catalogModeImpact(m.id, user);
    let signal!: () => void; const locked = new Promise<void>(resolve => { signal = resolve; });
    let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
    const writer = db.transaction(async tx => {
      await tx('modes').where({ id: m.id }).forUpdate().first(); signal(); await ready;
      await tx('billing_orders').insert({ account_id: account, status: 'awaiting_payment', duration_days: 30, amount_cop: 100, snapshot: JSON.stringify({ items: [{ modeId: m.id }] }), created_by: user.id });
    });
    await locked;
    const deletion = removeCatalogMode(m.id, initial, user);
    release(); await writer;
    await expect(deletion).rejects.toThrow('CATALOG_IMPACT_CHANGED');
  });
});
