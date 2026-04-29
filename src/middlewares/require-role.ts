import { jsonError } from '../lib/http.ts';

export function requireRole(roleSlug: string) {
  return (req: any, res: any, next: any) => {
    const user = req.authUser;
    if (!user) {
      jsonError(res, 401, 'No autenticado');
      return;
    }

    if (user.estado !== 'active') {
      jsonError(res, 403, 'Usuario sin acceso activo');
      return;
    }

    const hasRole = Array.isArray(user.roles) && user.roles.some((role: any) => role.slug === roleSlug);
    if (!hasRole) {
      jsonError(res, 403, `Rol requerido: ${roleSlug}`);
      return;
    }

    next();
  };
}
