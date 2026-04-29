import { jsonError } from '../lib/http.ts';
import { verifyAccessToken } from '../services/token.service.ts';
import { buildAuthUser } from '../services/user.service.ts';

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

    const payload = verifyAccessToken(token);

    if (!payload || payload.tipo !== 'access' || !payload.sub) {
      jsonError(res, 401, 'Token invalido');
      return;
    }

    const userId = Number(payload.sub);
    const authUser = await buildAuthUser(userId);

    if (!authUser) {
      jsonError(res, 401, 'Usuario no encontrado');
      return;
    }

    req.authUser = authUser;
    next();
  } catch (error) {
    jsonError(res, 401, 'Token expirado o invalido');
  }
}
