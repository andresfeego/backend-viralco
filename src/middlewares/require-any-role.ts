import { jsonError } from '../lib/http.ts';

export function requireAnyRole(roleSlugs: string[]) {
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

    const userRoleSet = new Set(Array.isArray(user.roles) ? user.roles.map((role: any) => role.slug) : []);
    const allowed = roleSlugs.some((slug) => userRoleSet.has(slug));
    if (!allowed) {
      jsonError(res, 403, `Rol requerido: ${roleSlugs.join(' o ')}`);
      return;
    }

    next();
  };
}
