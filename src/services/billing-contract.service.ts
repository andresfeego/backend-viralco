import { sql } from 'drizzle-orm';
import { quoteModes } from '../domain/billing.ts';
import { ServiceError } from '../lib/service-error.ts';

// Runs on the same Drizzle transaction as the account and membership creation.
export async function createInitialBillingContract(tx: any, accountId: bigint, subscription: any, durationDays: number, userId: bigint) {
  const [rows] = await tx.execute(sql`select c.*, m.slug from billing_catalog c join modes m on m.id = c.mode_id order by c.mode_id for update`);
  const catalog = rows.map((row: any) => ({ modeId: String(row.mode_id), slug: row.slug, name: row.name, available: Boolean(row.available) && !row.archived_at, implemented: ['espejo', 'cabina', 'video-360'].includes(row.slug), prices: { 30: row.price_30_cop == null ? null : Number(row.price_30_cop), 365: row.price_365_cop == null ? null : Number(row.price_365_cop) } }));
  const quote = quoteModes(catalog, subscription.modes.map((item: any) => String(item.mode.id)), durationDays);
  await tx.execute(sql`insert into billing_contracts (account_id, duration_days, amount_cop, services, source) values (${accountId}, ${durationDays}, ${quote.amountCop}, ${JSON.stringify(quote.items)}, 'account_creation')`);
  await tx.execute(sql`insert into billing_orders (account_id, open_account_id, status, duration_days, amount_cop, snapshot, created_by) values (${accountId}, ${accountId}, 'awaiting_payment', ${durationDays}, ${quote.amountCop}, ${JSON.stringify({ ...quote, kind: 'initial' })}, ${userId})`);
  return quote;
}

export const readBillingJson = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
export function mapBillingContract(row: any) {
  return row ? { durationDays: row.duration_days, amountCop: Number(row.amount_cop), currency: 'COP', items: readBillingJson(row.services), createdAt: new Date(row.created_at).toISOString() } : null;
}

export async function insertContractRenewal(tx: any, account: any, now: Date) {
  const open = await tx('billing_orders').where({ open_account_id: account.id }).first();
  if (open) return { order: open, created: false };
  const contract = mapBillingContract(await tx('billing_contracts').where({ account_id: account.id }).first());
  if (!contract) throw new ServiceError(409, 'La cuenta no tiene una contratacion disponible');
  const last = await tx('billing_periods').where({ account_id: account.id }).orderBy('ends_at', 'desc').first();
  if (last && await tx('billing_orders').where({ renewal_period_id: last.id }).first()) return { order: null, created: false };
  const ids = contract.items.map((item: any) => item.modeId);
  const catalog = await tx('billing_catalog').whereIn('mode_id', ids);
  if (catalog.length !== ids.length || catalog.some((row: any) => row.archived_at || !row.available)) throw new ServiceError(409, 'Servicio no disponible para renovacion');
  const [orderId] = await tx('billing_orders').insert({ account_id: account.id, open_account_id: account.id, renewal_period_id: last?.id || null, status: 'awaiting_payment', duration_days: contract.durationDays, amount_cop: contract.amountCop, snapshot: JSON.stringify({ ...contract, kind: last ? 'renewal' : 'initial' }), created_by: account.owner_user_id, created_at: now, updated_at: now });
  await tx('billing_notices').insert({ account_id: account.id, order_id: orderId, kind: last ? 'renewal_ready' : 'initial_ready', created_at: now });
  return { order: await tx('billing_orders').where({ id: orderId }).first(), created: true };
}
