import { jsonError } from '../lib/http.ts';
import { verifyAccessToken } from '../services/token.service.ts';
import { buildAuthUser } from '../services/user.service.ts';
import { parseEntityId } from '../lib/ids.ts';
import { sendApiError } from '../lib/api-error.ts';

function readBearerToken(req: any) {
  const authHeader = req.headers.authorization || '';
  const [schema, token] = authHeader.split(' ');
  if (schema?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}

export async function requireAuth(req: any, res: any, next: any) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      jsonError(res, 401, 'Token de acceso requerido');
      return;
    }

    let payload;
    try { payload = verifyAccessToken(token); }
    catch { jsonError(res, 401, 'Token expirado o invalido'); return; }

    if (!payload || payload.tipo !== 'access' || !payload.sub) {
      jsonError(res, 401, 'Token invalido');
      return;
    }

    const userId = parseEntityId(payload.sub, 'ID de usuario');
    const authUser = await buildAuthUser(userId);

    if (!authUser) {
      jsonError(res, 401, 'Usuario no encontrado');
      return;
    }

    req.authUser = authUser;
    next();
  } catch (error) {
    // Database/server unavailability is not proof of revoked credentials.
    sendApiError(req, res, error, 'No se pudo comprobar la sesion');
  }
}
