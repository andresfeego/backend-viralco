import { randomUUID } from 'node:crypto';
import { billingDb as db } from '../db/billing.ts';
import { ServiceError } from '../lib/service-error.ts';
import { parseEntityId } from '../lib/ids.ts';
import { isSuperAdmin } from './account-access.service.ts';

const authorize = (user: any) => { if (!isSuperAdmin(user)) throw new ServiceError(403, 'Se requiere Super Admin'); };
const entityId = (value: any) => { try { return String(parseEntityId(value)); } catch { throw new ServiceError(400, 'Identificador invalido'); } };
const conflict = () => new ServiceError(409, JSON.stringify({ code: 'BANK_OPTION_CHANGED', message: 'La opcion cambio. Actualiza la lista antes de editarla.' }));
export function transferBankDetails(input: any) {
  const limits = { bank: 160, holder: 160, identification: 80, accountType: 80, accountNumber: 80, instructions: 2000 };
  return Object.fromEntries(Object.entries(limits).map(([key, max]) => {
    const value = key === 'instructions' ? input?.[key] ?? '' : input?.[key];
    if (typeof value !== 'string' || value.trim().length > max || (key !== 'instructions' && !value.trim())) throw new ServiceError(400, 'Datos de transferencia incompletos o demasiado largos');
    return [key, value.trim()];
  }));
}
function activeValue(value: any) {
  if (typeof value !== 'boolean') throw new ServiceError(400, 'Estado activo invalido');
  return value;
}
function mapBank(row: any) {
  return { ...(typeof row.bank_details === 'string' ? JSON.parse(row.bank_details) : row.bank_details), id: String(row.id), active: Boolean(row.active), revision: Number(row.revision) };
}
export async function listBankOptions(tx: any = db, activeOnly = false) {
  const query = tx('billing_bank_options').orderBy('id');
  return (await (activeOnly ? query.where({ active: true }) : query)).map(mapBank);
}
async function audit(tx: any, bankId: string, user: any, action: string, active: boolean) {
  await tx('bitacora').insert({ actor_user_id: entityId(user.id), actor_email: user.email || null, canal: 'api', accion: `billing.bank.${action}`, entidad_tipo: 'bank_option', entidad_id: bankId, resultado: 'success', http_method: action === 'create' ? 'POST' : 'PUT', http_path: `/api/billing/admin/banks/${bankId}`, http_status: 200, request_id: randomUUID(), payload_resumen: JSON.stringify({ active }), mensaje: `Transfer option ${action}`, created_at: new Date() });
}
export async function createBankOption(input: any, user: any) {
  authorize(user);
  const details = transferBankDetails(input), active = activeValue(input.active);
  return db.transaction(async tx => {
    const [newId] = await tx('billing_bank_options').insert({ bank_details: JSON.stringify(details), active, updated_by: entityId(user.id) });
    await audit(tx, String(newId), user, 'create', active);
    return mapBank(await tx('billing_bank_options').where({ id: newId }).first());
  });
}
export async function updateBankOption(value: any, input: any, user: any, stateOnly = false) {
  authorize(user);
  const bankId = entityId(value), active = activeValue(input.active);
  const details = stateOnly ? null : transferBankDetails(input);
  return db.transaction(async tx => {
    const row = await tx('billing_bank_options').where({ id: bankId }).forUpdate().first();
    if (!row) throw new ServiceError(404, 'Opcion de transferencia no encontrada');
    if (!Number.isSafeInteger(input.revision) || input.revision !== Number(row.revision)) throw conflict();
    await tx('billing_bank_options').where({ id: bankId }).update({ ...(details ? { bank_details: JSON.stringify(details) } : {}), active, revision: Number(row.revision) + 1, updated_by: entityId(user.id), updated_at: new Date() });
    await audit(tx, bankId, user, stateOnly ? (active ? 'activate' : 'deactivate') : 'update', active);
    return mapBank(await tx('billing_bank_options').where({ id: bankId }).first());
  });
}
export async function selectTransferBank(tx: any, bankId?: any) {
  let query = tx('billing_bank_options').where({ active: true }).orderBy('id');
  if (bankId != null) query = query.where({ id: entityId(bankId) });
  // Serialize with edits/deactivation. Orders that win this lock retain the old snapshot.
  const row = await query.forUpdate().first();
  if (!row) throw new ServiceError(409, JSON.stringify({ code: 'BANK_OPTION_UNAVAILABLE', message: 'No hay una opcion de transferencia activa. Actualiza y selecciona otra.' }));
  return mapBank(row);
}

// Legacy readers receive a single active destination; new clients use banks[].
export async function bankSettings(tx: any = db) { return (await listBankOptions(tx, true))[0] || null; }
export async function saveBankSettings(input: any, user: any) {
  authorize(user);
  const options = await listBankOptions();
  if (options.length > 1) throw new ServiceError(409, 'Actualiza la aplicacion para editar multiples opciones de transferencia');
  return options.length
    ? updateBankOption(options[0].id, { ...input, active: options[0].active, revision: options[0].revision }, user)
    : createBankOption({ ...input, active: true }, user);
}
