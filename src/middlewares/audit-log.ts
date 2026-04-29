import crypto from 'crypto';
import { logBitacoraEvent } from '../services/bitacora.service.ts';

function sanitizeBody(body: any) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const blockList = new Set(['password', 'newPassword', 'token', 'refreshToken']);
  const safe: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (blockList.has(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && value.length > 120) {
      safe[key] = `${value.slice(0, 120)}...`;
      continue;
    }
    safe[key] = value;
  }
  return JSON.stringify(safe);
}

function buildAccion(req: any) {
  const method = String(req.method || 'GET').toLowerCase();
  const rawPath = String(req.originalUrl || req.path || '/').split('?')[0];
  const normalizedPath = rawPath.replace(/\/\d+/g, '/:id').replace(/^\/+/, '').replace(/\//g, '.');
  return `${method}.${normalizedPath || 'root'}`;
}

function detectCanal(req: any) {
  const explicit = String(req.headers['x-client-channel'] || '').trim();
  if (explicit) {
    return explicit;
  }
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('okhttp') || ua.includes('cfnetwork') || ua.includes('reactnative')) {
    return 'app_mobile';
  }
  if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) {
    return 'web_front';
  }
  return 'api';
}

function hashIp(req: any) {
  const ip = String(req.ip || req.headers['x-forwarded-for'] || '');
  if (!ip) {
    return null;
  }
  return crypto.createHash('sha256').update(ip).digest('hex');
}

export function auditLogMiddleware(req: any, res: any, next: any) {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  res.on('finish', () => {
    const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
    if (!requestPath.startsWith('/api/')) {
      return;
    }
    if (requestPath === '/health') {
      return;
    }

    const status = Number(res.statusCode || 200);
    const isSuccess = status >= 200 && status < 400;
    const authUser = req.authUser || null;
    const fallbackEmail = typeof req.body?.email === 'string' ? String(req.body.email).trim().toLowerCase() : null;

    logBitacoraEvent({
      actorUserId: authUser?.id ? Number(authUser.id) : null,
      actorEmail: authUser?.email || fallbackEmail,
      actorRoles: Array.isArray(authUser?.roles) ? JSON.stringify(authUser.roles.map((r: any) => r.slug)) : null,
      canal: detectCanal(req),
      accion: buildAccion(req),
      resultado: isSuccess ? 'success' : 'fail',
      httpMethod: req.method,
      httpPath: requestPath,
      httpStatus: status,
      requestId,
      ipHash: hashIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
      payloadResumen: sanitizeBody(req.body),
      mensaje: `${req.method} ${req.path} -> ${status}`,
      errorCode: isSuccess ? null : `HTTP_${status}`,
      errorDetalle: isSuccess ? null : 'Operacion finalizo con error HTTP',
    }).catch((error) => {
      console.error('[bitacora] error registrando evento', error);
    });
  });

  next();
}
