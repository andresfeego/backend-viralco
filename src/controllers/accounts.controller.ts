import { sendApiError } from '../lib/api-error.ts';
import { createSelfServiceAccount, getAccount, listAccounts, listMembers, removeAccount, updateAccount } from '../services/accounts.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  sendApiError(res.req, res, error, fallback);
}

export async function getAccounts(req: any, res: any) {
  try { res.status(200).json({ accounts: await listAccounts(req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudieron listar cuentas'); }
}
export async function postAccountSelf(req: any, res: any) {
  try { res.status(201).json({ account: await createSelfServiceAccount(req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo crear cuenta'); }
}
export async function getAccountById(req: any, res: any) {
  try { res.status(200).json({ account: await getAccount(req.params.accountId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo obtener cuenta'); }
}
export async function patchAccount(req: any, res: any) {
  try { res.status(200).json({ account: await updateAccount(req.params.accountId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar cuenta'); }
}
export async function deleteAccount(req: any, res: any) {
  try { res.status(200).json(await removeAccount(req.params.accountId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo eliminar cuenta'); }
}
export async function getMembers(req: any, res: any) {
  try { res.status(200).json({ members: await listMembers(req.params.accountId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudieron listar miembros'); }
}
