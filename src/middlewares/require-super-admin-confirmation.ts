import { jsonError } from '../lib/http.ts';
import { verifySuperAdminConfirmToken } from '../services/token.service.ts';

function readConfirmationToken(req: any) {
  const headerValue = req.headers['x-super-admin-confirmation'];
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  if (headerValue.toLowerCase().startsWith('bearer ')) {
    return headerValue.slice(7).trim();
  }

  return headerValue.trim();
}

export function requireSuperAdminConfirmation(req: any, res: any, next: any) {
  const token = readConfirmationToken(req);
  if (!token) {
    jsonError(res, 401, 'Confirmacion adicional de Super Admin requerida');
    return;
  }

  try {
    const payload = verifySuperAdminConfirmToken(token);
    const authUser = req.authUser;

    if (!payload || payload.tipo !== 'super_admin_confirm' || !payload.sub || !authUser) {
      jsonError(res, 401, 'Token de confirmacion invalido');
      return;
    }

    if (Number(payload.sub) !== Number(authUser.id)) {
      jsonError(res, 401, 'Token de confirmacion no corresponde al usuario autenticado');
      return;
    }

    next();
  } catch (error) {
    jsonError(res, 401, 'Token de confirmacion expirado o invalido');
  }
}
