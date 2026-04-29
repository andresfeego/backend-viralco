import { jsonError } from '../lib/http.ts';

export function requirePermission(permissionSlug: string) {
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

    const hasPermission =
      Array.isArray(user.permissions) && user.permissions.some((permission: any) => permission.slug === permissionSlug);

    if (!hasPermission) {
      jsonError(res, 403, `Permiso requerido: ${permissionSlug}`);
      return;
    }

    next();
  };
}
