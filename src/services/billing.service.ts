import { billingDb as db } from '../db/billing.ts';
import { assertTransferApproval, copAmount, expiryNotice, renewalWindow } from '../domain/billing.ts';
import { ServiceError } from '../lib/service-error.ts';
import { parseEntityId } from '../lib/ids.ts';
import { assertAccountAccess, isSuperAdmin } from './account-access.service.ts';
import { signAuthorizedBillingReceipt, storeBillingReceipt } from './billing-receipt-storage.ts';
import { listBankOptions } from './billing-bank.service.ts';
import { insertContractRenewal, mapBillingContract } from './billing-contract.service.ts';
import { PROVISIONAL_REVIEW_MS, reportedPeriod } from '../domain/billing-renewals.ts';
export { bankSettings, saveBankSettings } from './billing-bank.service.ts';

export const billingJson = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
const id = (value: any) => { try { return String(parseEntityId(value)); } catch { throw new ServiceError(400, 'Identificador invalido'); } };
const iso = (value: any) => new Date(value).toISOString();
const implemented = new Set(['espejo', 'cabina', 'video-360']);
const text = (value: any, max: number, required = true) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new ServiceError(400, 'Campo requerido o demasiado largo');
  return value.trim();
};
function superadmin(user: any) { if (!isSuperAdmin(user)) throw new ServiceError(403, 'Se requiere Super Admin'); }
async function manager(accountId: string, user: any) {
  // Payment remains possible after commercial expiry, but never after role revocation.
  const access = await assertAccountAccess(BigInt(accountId), user, 'read');
  if (!['owner', 'admin', 'super_admin'].includes(access.roleSlug)) throw new ServiceError(403, 'Se requiere propietario o administrador');
  return access;
}
function mapCatalog(row: any) {
  return { modeId: String(row.mode_id), slug: row.slug, name: row.name, description: row.description || '', features: billingJson(row.features) || [], order: row.display_order,
    archivedAt: row.archived_at ? iso(row.archived_at) : null, available: !row.archived_at && Boolean(row.available), implemented: implemented.has(row.slug), prices: { 30: row.price_30_cop == null ? null : Number(row.price_30_cop), 365: row.price_365_cop == null ? null : Number(row.price_365_cop) } };
}
export async function listBillingCatalog(tx: any = db, archived = false) {
  const query = tx('billing_catalog as c').join('modes as m', 'm.id', 'c.mode_id').select('c.*', 'm.slug').orderBy('c.display_order').orderBy('c.mode_id');
  return (await (archived ? query.whereNotNull('c.archived_at') : query.whereNull('c.archived_at'))).map(mapCatalog);
}
export async function saveBillingCatalog(modeIdValue: any, input: any, user: any) {
  superadmin(user);
  const modeId = id(modeIdValue);
  const features = input.features;
  if (!Array.isArray(features) || features.length > 30 || features.some((v: any) => typeof v !== 'string' || !v.trim() || v.length > 300)) throw new ServiceError(400, 'Caracteristicas invalidas');
  if (!Number.isSafeInteger(input.order) || input.order < 0 || input.order > 100000) throw new ServiceError(400, 'Orden invalido');
  const prices = { price_30_cop: input.prices?.[30] == null ? null : copAmount(input.prices[30]), price_365_cop: input.prices?.[365] == null ? null : copAmount(input.prices[365]) };
  if (input.available && (!prices.price_30_cop || !prices.price_365_cop)) throw new ServiceError(400, 'Configura ambas tarifas COP antes de habilitar contrataciones');
  const mode = await db('modes').where({ id: modeId }).first();
  if (!mode) throw new ServiceError(404, 'Modo no encontrado');
  if (input.available && !implemented.has(mode.slug)) throw new ServiceError(409, 'El modo requiere una experiencia compatible antes de venderse');
  const changed = await db('billing_catalog').where({ mode_id: modeId }).whereNull('archived_at').update({ name: text(input.name, 160), description: text(input.description || '', 2000, false), features: JSON.stringify(features.map((v: string) => v.trim())), display_order: input.order, ...prices, available: input.available === true, updated_at: new Date() });
  if (!changed) throw new ServiceError(409, 'Restaura el modo antes de editarlo');
  return listBillingCatalog();
}
export async function createCommercialMode(input: any, user: any) {
  superadmin(user);
  const slug = text(input.slug, 64);
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new ServiceError(400, 'Identificador invalido');
  await db.transaction(async tx => {
    if (await tx('modes').where({ slug }).first()) throw new ServiceError(409, 'Identificador existente');
    const name = text(input.name, 120);
    const [modeId] = await tx('modes').insert({ slug, name, description: '', is_default: false, price_amount: 0, price_currency: 'COP' });
    await tx('billing_catalog').insert({ mode_id: modeId, name, features: '[]', available: false });
  });
  return listBillingCatalog();
}
export async function billingState(accountIdValue: any, tx: any = db, now = new Date()) {
  const accountId = id(accountIdValue);
  const account = await tx('accounts').where({ id: accountId }).first();
  if (!account) throw new ServiceError(404, 'Cuenta no encontrada');
  const sub = await tx('subscriptions').where({ account_id: accountId }).orderBy('starts_at', 'desc').orderBy('id', 'desc').first();
  const blocked = account.status !== 'active' || ['suspended', 'canceled'].includes(sub?.status);
  const periods = await tx('billing_periods').where({ account_id: accountId }).orderBy('starts_at');
  const map = (p: any) => ({ id: String(p.id), source: p.source, services: billingJson(p.services), startsAt: iso(p.starts_at), endsAt: iso(p.ends_at), orderId: p.order_id ? String(p.order_id) : null });
  const pending = await tx('billing_reports as r').join('billing_orders as o', 'o.id', 'r.order_id').where({ 'o.account_id': accountId, 'o.status': 'pending_review', 'r.status': 'pending_review' }).select('r.id', 'r.order_id', 'r.period_starts_at', 'o.provisional_until', 'o.snapshot').first();
  const provisional = pending?.provisional_until ? { id: `report:${pending.id}`, reportId: String(pending.id), orderId: String(pending.order_id), source: 'provisional', services: billingJson(pending.snapshot).items, startsAt: iso(pending.period_starts_at), endsAt: iso(pending.provisional_until) } : null;
  const authorizationPeriods = [...periods.map(map), ...(provisional && new Date(provisional.startsAt) < new Date(provisional.endsAt) ? [provisional] : [])];
  const current = authorizationPeriods.find(p => new Date(p.startsAt) <= now && now < new Date(p.endsAt));
  const last = periods.at(-1);
  return { accountId, accountName: account.name, system: Boolean(account.is_system), administrativelyBlocked: blocked, active: !blocked && (Boolean(account.is_system) || Boolean(current)), current: current || null,
    periods: periods.map(map), authorizationPeriods, provisional, notice: last ? expiryNotice(now, last.ends_at) : { kind: 'unpaid', daysRemaining: 0 }, serverTime: now.toISOString() };
}
export async function assertBillingActive(accountId: any, modeSlug?: string) {
  const state = await billingState(accountId);
  if (!state.active) throw new ServiceError(403, JSON.stringify({ code: state.administrativelyBlocked ? 'BILLING_ADMINISTRATIVE_BLOCK' : 'BILLING_SUBSCRIPTION_EXPIRED', message: state.administrativelyBlocked ? 'Cuenta suspendida administrativamente' : 'La suscripcion vencio o esta pendiente de pago' }));
  if (modeSlug && !state.system && !state.current?.services.some((m: any) => m.slug === modeSlug)) throw new ServiceError(403, 'Servicio no contratado');
  return state;
}
function mapOrder(row: any) { return { id: String(row.id), accountId: String(row.account_id), status: row.status, durationDays: row.duration_days, amountCop: Number(row.amount_cop), snapshot: billingJson(row.snapshot), createdAt: iso(row.created_at), provisionalUntil: row.provisional_until ? iso(row.provisional_until) : null }; }
export async function accountBilling(accountIdValue: any, user: any) {
  const accountId = id(accountIdValue); await manager(accountId, user);
  const state = await billingState(accountId);
  const orders = await db('billing_orders').where({ account_id: accountId }).orderBy('id', 'desc');
  const subscription = await db('subscriptions').where({ account_id: accountId }).orderBy('starts_at', 'desc').orderBy('id', 'desc').first();
  const preference = billingJson(subscription?.metadata)?.billingPreference || null;
  const reports = await db('billing_reports as r').join('billing_orders as o', 'o.id', 'r.order_id').leftJoin('billing_reviews as v', 'v.report_id', 'r.id').where('o.account_id', accountId).select('r.id', 'r.order_id', 'r.status', 'r.amount_cop', 'r.transfer_date', 'r.reference', 'r.created_at', 'r.period_starts_at', 'r.period_ends_at', 'v.reason').orderBy('r.id', 'desc');
  const banks = await listBankOptions(db, true);
  const contract = mapBillingContract(await db('billing_contracts').where({ account_id: accountId }).first());
  const notices = await db('billing_notices as n').join('billing_orders as o', 'o.id', 'n.order_id').where({ 'n.account_id': accountId, 'o.status': 'awaiting_payment' }).select('n.order_id', 'n.kind', 'n.created_at');
  const last = state.periods.at(-1);
  return { ...state, contract, preference, bank: banks[0] || null, banks, notices: notices.map(n => ({ orderId: String(n.order_id), kind: n.kind, createdAt: iso(n.created_at) })), orders: orders.map(row => ({ ...mapOrder(row), expectedStart: renewalWindow(new Date(), last?.endsAt || null, row.duration_days).startsAt })), reports: reports.map((r: any) => ({ id: String(r.id), orderId: String(r.order_id), status: r.status, amountCop: Number(r.amount_cop), transferDate: r.transfer_date, reference: r.reference, reason: r.reason, createdAt: r.created_at, periodStartsAt: r.period_starts_at ? iso(r.period_starts_at) : null, periodEndsAt: r.period_ends_at ? iso(r.period_ends_at) : null })) };
}
export async function createBillingOrder(accountIdValue: any, input: any, user: any) {
  const accountId = id(accountIdValue); await manager(accountId, user);
  if (input.modeIds != null && !Array.isArray(input.modeIds)) throw new ServiceError(400, 'Servicios invalidos');
  return db.transaction(async tx => {
    // Same parent locks as catalog retirement; acquire before reading the quote.
    await tx('modes').select('id').orderBy('id').forUpdate();
    const account = await tx('accounts').where({ id: accountId }).forUpdate().first();
    if (await tx('billing_orders').where({ open_account_id: accountId }).first()) throw new ServiceError(409, 'Ya existe una orden abierta');
    const contract = mapBillingContract(await tx('billing_contracts').where({ account_id: accountId }).first());
    if (!contract || (input.durationDays != null && input.durationDays !== contract.durationDays) || (input.modeIds != null && JSON.stringify([...input.modeIds].sort()) !== JSON.stringify(contract.items.map((item: any) => item.modeId).sort()))) throw new ServiceError(409, 'La contratacion se define al crear la cuenta');
    const result = await insertContractRenewal(tx, account, new Date());
    if (!result.order) throw new ServiceError(409, 'La renovacion ya fue generada');
    return mapOrder(result.order);
  });
}
export async function cancelBillingOrder(accountIdValue: any, orderIdValue: any, user: any) {
  const accountId = id(accountIdValue); await manager(accountId, user);
  if (await db('billing_contracts').where({ account_id: accountId }).first()) throw new ServiceError(409, 'El recibo pendiente conserva la contratacion de la cuenta');
  await db.transaction(async tx => {
    await tx('accounts').where({ id: accountId }).forUpdate().first();
    const order = await tx('billing_orders').where({ id: id(orderIdValue), account_id: accountId }).forUpdate().first();
    if (!order || order.status !== 'awaiting_payment') throw new ServiceError(409, 'Solo se puede cancelar una orden sin reporte pendiente');
    await tx('billing_orders').where({ id: order.id }).update({ status: 'canceled', open_account_id: null, updated_at: new Date() });
  });
  return { canceled: true };
}
export async function submitTransfer(accountIdValue: any, orderIdValue: any, input: any, file: any, user: any) {
  const accountId = id(accountIdValue); await manager(accountId, user);
  const amount = copAmount(Number(input.amountCop));
  const reference = text(input.reference ?? '', 160, false);
  const date = text(input.transferDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date || date > new Date().toISOString().slice(0, 10)) throw new ServiceError(400, 'Fecha de transferencia invalida');
  // Hold the account/order lock through storage to serialize concurrent reports.
  return db.transaction(async tx => {
    await tx('accounts').where({ id: accountId }).forUpdate().first();
    const order = await tx('billing_orders').where({ id: id(orderIdValue), account_id: accountId }).forUpdate().first();
    if (!order || order.status !== 'awaiting_payment') throw new ServiceError(409, 'La orden no permite otro reporte');
    if (amount !== Number(order.amount_cop)) throw new ServiceError(409, 'El importe debe coincidir con el recibo');
    const receipt = await storeBillingReceipt(accountId, file);
    const now = new Date();
    const last = await tx('billing_periods').where({ account_id: accountId }).orderBy('ends_at', 'desc').first();
    const window = reportedPeriod(now, last?.ends_at || null, order.duration_days);
    const previous = await tx('billing_reports').where({ order_id: order.id }).orderBy('id').first();
    const provisionalUntil = order.provisional_until || new Date(new Date(previous?.created_at || now).getTime() + PROVISIONAL_REVIEW_MS);
    const [reportId] = await tx('billing_reports').insert({ order_id: order.id, amount_cop: amount, transfer_date: date, reference, reference_normalized: reference.toUpperCase().replace(/\s+/g, ''), receipt_key: receipt.key, receipt_sha256: receipt.sha256, content_type: receipt.contentType, size_bytes: receipt.sizeBytes, created_by: id(user.id), created_at: now, period_starts_at: new Date(window.startsAt), period_ends_at: new Date(window.endsAt) });
    await tx('billing_orders').where({ id: order.id }).update({ status: 'pending_review', provisional_until: provisionalUntil, updated_at: now });
    return { id: String(reportId), status: 'pending_review', provisionalUntil: iso(provisionalUntil), period: window };
  });
}
export async function listTransferReports(input: any, user: any) {
  superadmin(user);
  const status = input.status || 'pending_review';
  if (!['pending_review', 'approved', 'rejected'].includes(status)) throw new ServiceError(400, 'Estado invalido');
  const query = db('billing_reports as r').join('billing_orders as o', 'o.id', 'r.order_id').join('accounts as a', 'a.id', 'o.account_id').leftJoin('billing_reviews as v', 'v.report_id', 'r.id').where('r.status', status);
  if (input.cursor) query.where('r.id', '<', id(input.cursor));
  if (input.search) query.where('a.name', 'like', `%${String(input.search).slice(0, 160)}%`);
  const rows = await query.select('r.*', 'o.account_id', 'o.amount_cop as expected_amount', 'o.snapshot', 'a.name as account_name', 'v.reason', 'v.observations', 'v.reviewed_by', 'v.created_at as reviewed_at').orderBy('r.id', 'desc').limit(200);
  return Promise.all(rows.map(async (r: any) => {
    const duplicates = await db('billing_reports').whereNot('id', r.id).where(q => { q.where('receipt_sha256', r.receipt_sha256); if (r.reference_normalized) q.orWhere('reference_normalized', r.reference_normalized); }).count('* as count').first();
    return { id: String(r.id), orderId: String(r.order_id), accountId: String(r.account_id), accountName: r.account_name, status: r.status, amountCop: Number(r.amount_cop), expectedAmountCop: Number(r.expected_amount), transferDate: r.transfer_date, reference: r.reference, snapshot: billingJson(r.snapshot), duplicateCount: Number(duplicates?.count || 0), reason: r.reason, observations: r.observations || null, reviewedBy: r.reviewed_by ? String(r.reviewed_by) : null, reviewedAt: r.reviewed_at };
  }));
}
export async function receiptLink(reportIdValue: any, user: any) {
  const row = await db('billing_reports as r').join('billing_orders as o', 'o.id', 'r.order_id').where('r.id', id(reportIdValue)).select('r.receipt_key', 'r.content_type', 'r.size_bytes', 'r.receipt_sha256', 'o.account_id').first();
  if (!row) throw new ServiceError(404, 'Comprobante no encontrado');
  // Superadmin can audit historical receipts even after an account is archived.
  if (!isSuperAdmin(user)) await manager(String(row.account_id), user);
  const link = await signAuthorizedBillingReceipt({ key: row.receipt_key, accountId: String(row.account_id) });
  return { ...link, contentType: row.content_type, sizeBytes: Number(row.size_bytes), sha256: row.receipt_sha256 };
}
export async function reviewTransfer(reportIdValue: any, input: any, user: any) {
  superadmin(user);
  if (!['approved', 'rejected'].includes(input.decision)) throw new ServiceError(400, 'Decision invalida');
  const observations = text(input.observations ?? '', 2000, false) || null;
  const reportId = id(reportIdValue);
  const initial = await db('billing_reports as r').join('billing_orders as o', 'o.id', 'r.order_id').where('r.id', reportId).select('o.account_id').first();
  if (!initial) throw new ServiceError(404, 'Reporte no encontrado');
  return db.transaction(async tx => {
    await tx('accounts').where({ id: initial.account_id }).forUpdate().first();
    const report = await tx('billing_reports').where({ id: reportId }).forUpdate().first();
    const order = await tx('billing_orders').where({ id: report.order_id }).forUpdate().first();
    if (report.status !== 'pending_review' || order.status !== 'pending_review') throw new ServiceError(409, 'Este reporte ya fue resuelto');
    const now = new Date();
    if (input.decision === 'rejected') {
      const reason = text(input.reason, 2000);
      await tx('billing_reviews').insert({ report_id: reportId, decision: 'rejected', reason, observations, reviewed_by: id(user.id) });
      await tx('billing_reports').where({ id: reportId }).update({ status: 'rejected' });
      await tx('billing_orders').where({ id: order.id }).update({ status: 'awaiting_payment', updated_at: now });
      return { status: 'rejected' };
    }
    const approval = assertTransferApproval({ status: report.status, expectedAmountCop: Number(order.amount_cop), reportedAmountCop: Number(report.amount_cop), receivedAmountCop: input.receivedAmountCop, receivedConfirmed: input.receivedConfirmed, bankReference: input.bankReference });
    const duplicate = await tx('billing_reports').whereNot('id', reportId).where(q => { q.where('receipt_sha256', report.receipt_sha256); if (report.reference_normalized) q.orWhere('reference_normalized', report.reference_normalized); }).first();
    if (duplicate && input.duplicatesAcknowledged !== true) throw new ServiceError(409, 'Revisa la referencia o comprobante repetido y confirma la advertencia');
    const last = await tx('billing_periods').where({ account_id: order.account_id }).orderBy('ends_at', 'desc').first();
    // Confirmation must not restart a period whose clock began on submission.
    const window = report.period_starts_at && report.period_ends_at ? { startsAt: iso(report.period_starts_at), endsAt: iso(report.period_ends_at) } : reportedPeriod(new Date(report.created_at), last?.ends_at || null, order.duration_days);
    await tx('billing_reviews').insert({ report_id: reportId, decision: 'approved', observations, bank_reference: approval.bankReference, received_amount_cop: approval.amountCop, reviewed_by: id(user.id) });
    await tx('billing_periods').insert({ account_id: order.account_id, order_id: order.id, source: 'transfer', services: JSON.stringify(billingJson(order.snapshot).items), starts_at: new Date(window.startsAt), ends_at: new Date(window.endsAt) });
    await tx('billing_reports').where({ id: reportId }).update({ status: 'approved' });
    await tx('billing_orders').where({ id: order.id }).update({ status: 'approved', open_account_id: null, updated_at: now });
    // Never lift an administrative suspension while confirming money received.
    await tx('subscriptions').where({ account_id: order.account_id }).whereIn('status', ['past_due', 'trialing', 'active']).update({ status: 'active', ends_at: new Date(window.endsAt), updated_at: now });
    return { status: 'approved', period: window };
  });
}
export async function reconcileBillingExpiry() {
  // Idempotent projection for old consumers; runtime enforcement queries dates.
  const now = new Date();
  const accounts = await db('accounts').where({ is_system: false, status: 'active' }).select('id');
  for (const account of accounts) {
    const state = await billingState(account.id, db, now);
    if (state.administrativelyBlocked) continue;
    await db('subscriptions').where({ account_id: account.id }).whereIn('status', ['active', 'trialing', 'past_due']).update({ status: state.active ? 'active' : 'past_due' });
  }
}
