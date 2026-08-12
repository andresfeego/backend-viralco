import { jsonError } from '../lib/http.ts';
import { serviceErrorStatus } from '../lib/service-error.ts';
import { forgotPassword, getMyProfile, loginUser, logoutUser, refreshSession, registerUser, resetPassword, updateMyTheme } from '../services/auth.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  jsonError(res, serviceErrorStatus(error), error instanceof Error ? error.message : fallback);
}

export async function register(req: any, res: any) {
  try { res.status(201).json(await registerUser(req.body || {})); }
  catch (error) { sendError(res, error, 'No se pudo registrar usuario'); }
}

export async function login(req: any, res: any) {
  try { res.status(200).json(await loginUser(req.body || {})); }
  catch (error) { sendError(res, error, 'No se pudo iniciar sesion'); }
}

export async function refresh(req: any, res: any) {
  try { res.status(200).json(await refreshSession(req.body?.refreshToken)); }
  catch (error) { sendError(res, error, 'No se pudo refrescar sesion'); }
}

export async function logout(req: any, res: any) {
  try { res.status(200).json(await logoutUser(req.body || {}, req.authUser?.id)); }
  catch (error) { sendError(res, error, 'No se pudo cerrar sesion'); }
}

export async function forgot(req: any, res: any) {
  try { res.status(200).json(await forgotPassword(req.body || {})); }
  catch (error) { sendError(res, error, 'No se pudo iniciar recuperacion'); }
}

export async function reset(req: any, res: any) {
  try { res.status(200).json(await resetPassword(req.body || {})); }
  catch (error) { sendError(res, error, 'No se pudo actualizar contrasena'); }
}

export async function getMe(req: any, res: any) {
  try { res.status(200).json(await getMyProfile(req.authUser.id)); }
  catch (error) { sendError(res, error, 'No se pudo obtener perfil'); }
}

export async function updateMyThemeController(req: any, res: any) {
  try { res.status(200).json(await updateMyTheme(req.authUser.id, req.body || {})); }
  catch (error) { sendError(res, error, 'No se pudo actualizar tema'); }
}
