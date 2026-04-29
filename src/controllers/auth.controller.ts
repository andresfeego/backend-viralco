import { jsonError } from '../lib/http.ts';
import {
  forgotPassword,
  loginUser,
  logoutUser,
  me,
  refreshSession,
  registerUser,
  resetPassword,
  updateMyThemeMode,
} from '../services/auth.service.ts';

function badRequest(res: any, error: any) {
  const message = error instanceof Error ? error.message : 'Solicitud invalida';
  jsonError(res, 400, message);
}

export async function register(req: any, res: any) {
  try {
    const result = await registerUser(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    badRequest(res, error);
  }
}

export async function login(req: any, res: any) {
  try {
    const result = await loginUser(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Credenciales invalidas';
    const status = message.toLowerCase().includes('credenciales') ? 401 : 400;
    jsonError(res, status, message);
  }
}

export async function refresh(req: any, res: any) {
  try {
    const refreshToken = req.body?.refreshToken;
    const result = await refreshSession(refreshToken);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo refrescar sesion';
    jsonError(res, 401, message);
  }
}

export async function logout(req: any, res: any) {
  try {
    const authUserId = req.authUser?.id ? Number(req.authUser.id) : undefined;
    const result = await logoutUser(req.body || {}, authUserId);
    res.status(200).json(result);
  } catch (error) {
    badRequest(res, error);
  }
}

export async function forgot(req: any, res: any) {
  try {
    const result = await forgotPassword(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    badRequest(res, error);
  }
}

export async function reset(req: any, res: any) {
  try {
    const result = await resetPassword(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    badRequest(res, error);
  }
}

export async function getMe(req: any, res: any) {
  try {
    const userId = Number(req.authUser?.id);
    const result = await me(userId);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo obtener perfil';
    jsonError(res, 400, message);
  }
}

export async function updateMyTheme(req: any, res: any) {
  try {
    const userId = Number(req.authUser?.id);
    const result = await updateMyThemeMode(userId, req.body || {});
    res.status(200).json(result);
  } catch (error) {
    badRequest(res, error);
  }
}
