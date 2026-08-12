import { jsonError } from '../lib/http.ts';

export function requireRole(roleSlug: string) {
  return (req: any, res: any, next: any) => {
    const user = req.authUser;
    if (!user) {
      jsonError(res, 401, 'No autenticado');
      return;
    }

    if (user.status?.slug !== 'active') {
      jsonError(res, 403, 'Usuario sin acceso activo');
      return;
    }

    const hasRole = Array.isArray(user.globalRoles) && user.globalRoles.some((role: any) => role.slug === roleSlug);
    if (!hasRole) {
      jsonError(res, 403, `Rol requerido: ${roleSlug}`);
      return;
    }

    next();
  };
}
