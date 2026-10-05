import { createHash, randomUUID } from 'node:crypto';
import { billingDb as db } from '../db/billing.ts';
import { ServiceError } from '../lib/service-error.ts';
import { parseEntityId } from '../lib/ids.ts';
import { isSuperAdmin } from './account-access.service.ts';

function authorize(user: any) { if (!isSuperAdmin(user)) throw new ServiceError(403, 'Se requiere Super Admin'); }
const conflict = () => new ServiceError(409, JSON.stringify({ code: 'CATALOG_IMPACT_CHANGED', message: 'El modo cambio. Consulta y confirma nuevamente la accion.' }));
async function lockMode(tx: any, modeId: string) {
  const mode = await tx('modes').where({ id: modeId }).forUpdate().first();
  const catalog = await tx('billing_catalog').where({ mode_id: modeId }).forUpdate().first();
  if (!mode || !catalog) throw new ServiceError(404, 'Modo no encontrado');
  return { ...mode, ...catalog };
}
async function impact(tx: any, mode: any) {
  const modeId = String(mode.mode_id);
  const count = async (query: any) => Number((await query.count('* as count').first()).count);
  const jsonUses = (table: string, column: string, path: string) => tx(table).where(q => {
    q.whereRaw('JSON_CONTAINS(JSON_EXTRACT(??, ?), ?) = 1', [column, `${path}[*].slug`, JSON.stringify(mode.slug)])
      .orWhereRaw('JSON_CONTAINS(JSON_EXTRACT(??, ?), ?) = 1', [column, `${path}[*].modeId`, JSON.stringify(modeId)])
      .orWhereRaw('JSON_CONTAINS(JSON_EXTRACT(??, ?), ?) = 1', [column, `${path}[*].modeId`, modeId]);
  });
  const usage = {
    events: await count(tx('event_modes').where({ mode_id: modeId })),
    subscriptions: await count(tx('subscription_modes').where({ mode_id: modeId })),
    preferences: await count(tx('subscriptions').whereRaw('JSON_CONTAINS(JSON_EXTRACT(metadata, ?), ?) = 1', ['$.billingPreference.modeSlugs', JSON.stringify(mode.slug)])),
    orders: await count(jsonUses('billing_orders', 'snapshot', '$.items')),
    periods: await count(jsonUses('billing_periods', 'services', '$')),
  };
  const action = Object.values(usage).some(value => value > 0) ? 'archive' : 'delete';
  const revision = createHash('sha256').update(JSON.stringify({ modeId, name: mode.name, action, usage, archivedAt: mode.archived_at, updatedAt: mode.updated_at })).digest('hex');
  return { modeId, name: mode.name, action, usage, revision, archived: Boolean(mode.archived_at) };
}
async function audit(tx: any, mode: any, user: any, action: string, usage?: any) {
  await tx('bitacora').insert({ actor_user_id: String(user.id), actor_email: user.email || null, canal: 'api', accion: `billing.catalog.${action}`, entidad_tipo: 'mode', entidad_id: String(mode.mode_id), resultado: 'success', http_method: 'POST', http_path: `/api/billing/admin/catalog/${mode.mode_id}/${action}`, http_status: 200, request_id: randomUUID(), payload_resumen: JSON.stringify({ name: mode.name, slug: mode.slug, usage }), mensaje: `Catalog mode ${action}`, created_at: new Date() });
}
export async function catalogModeImpact(value: any, user: any) {
  authorize(user); const modeId = String(parseEntityId(value));
  return db.transaction(async tx => impact(tx, await lockMode(tx, modeId)), { isolationLevel: 'read committed' });
}
export async function removeCatalogMode(value: any, input: any, user: any) {
  authorize(user); const modeId = String(parseEntityId(value));
  return db.transaction(async tx => {
    const mode = await lockMode(tx, modeId);
    const current = await impact(tx, mode);
    if (current.archived || input?.revision !== current.revision || input?.action !== current.action) throw conflict();
    if (current.action === 'archive') {
      await tx('billing_catalog').where({ mode_id: modeId }).update({ archived_at: new Date(), archived_by: String(user.id), available: false, updated_at: new Date() });
    } else {
      await tx('billing_catalog').where({ mode_id: modeId }).delete();
      await tx('modes').where({ id: modeId }).delete();
    }
    await audit(tx, mode, user, current.action, current.usage);
    return { action: current.action, modeId };
  }, { isolationLevel: 'read committed' });
}
export async function restoreCatalogMode(value: any, user: any) {
  authorize(user); const modeId = String(parseEntityId(value));
  return db.transaction(async tx => {
    const mode = await lockMode(tx, modeId);
    if (!mode.archived_at) throw conflict();
    await tx('billing_catalog').where({ mode_id: modeId }).update({ archived_at: null, archived_by: null, available: false, updated_at: new Date() });
    await audit(tx, mode, user, 'restore');
    return { modeId, restored: true };
  });
}
