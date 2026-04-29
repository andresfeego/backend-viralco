import { jsonError } from '../lib/http.ts';

export function requireActive(req: any, res: any, next: any) {
  const user = req.authUser;

  if (!user) {
    jsonError(res, 401, 'No autenticado');
    return;
  }

  if (user.estado !== 'active') {
    jsonError(res, 403, 'Usuario sin acceso activo');
    return;
  }

  next();
}
