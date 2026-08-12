import { env } from '../lib/env.ts';
import { jsonError } from '../lib/http.ts';
import { serviceErrorStatus } from '../lib/service-error.ts';
import { activateUser, changeUserStatus, createAdminUser, deactivateUser, listAdminUsers } from '../services/admin.service.ts';
import { createAccount, updateAccountStatus } from '../services/accounts.service.ts';
import { listBitacora } from '../services/bitacora.service.ts';
import { createSuperAdminConfirmToken } from '../services/token.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  jsonError(res, serviceErrorStatus(error), error instanceof Error ? error.message : fallback);
}

export async function confirmSuperAdminPassword(req: any, res: any) {
  try {
    if (String(req.body?.password || '') !== env.superAdminConfirmPassword) return jsonError(res, 401, 'Contrasena de confirmacion invalida');
    res.status(200).json({ confirmationToken: createSuperAdminConfirmToken(req.authUser.id) });
  } catch (error) { sendError(res, error, 'No se pudo confirmar acceso'); }
}

export async function getUsers(_req: any, res: any) {
  try { res.status(200).json({ users: await listAdminUsers() }); }
  catch (error) { sendError(res, error, 'No se pudo listar usuarios'); }
}

export async function createAdmin(req: any, res: any) {
  try { res.status(201).json({ user: await createAdminUser(req.body || {}) }); }
  catch (error) { sendError(res, error, 'No se pudo crear usuario'); }
}

export async function patchUserStatus(req: any, res: any) {
  try { res.status(200).json({ user: await changeUserStatus(req.params.id, req.body?.statusSlug) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar estado'); }
}

export async function activate(req: any, res: any) {
  try { res.status(200).json({ user: await activateUser(req.params.id) }); }
  catch (error) { sendError(res, error, 'No se pudo activar usuario'); }
}

export async function deactivate(req: any, res: any) {
  try { res.status(200).json({ user: await deactivateUser(req.params.id) }); }
  catch (error) { sendError(res, error, 'No se pudo suspender usuario'); }
}

export async function postAccount(req: any, res: any) {
  try { res.status(201).json({ account: await createAccount(req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo crear cuenta'); }
}

export async function patchAccountStatus(req: any, res: any) {
  try { res.status(200).json({ account: await updateAccountStatus(req.params.accountId, req.body?.status, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar cuenta'); }
}

export async function getBitacora(req: any, res: any) {
  try { res.status(200).json(await listBitacora(req.query || {})); }
  catch (error) { sendError(res, error, 'No se pudo consultar bitacora'); }
}
