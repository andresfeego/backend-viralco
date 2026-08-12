import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accountUsersTable, accountsTable, permissionsTable, rolePermissionsTable, rolesTable } from '../db/schema.ts';
import { parseEntityId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';

export function isSuperAdmin(user: any) {
  return user?.globalRoles?.some((role: any) => role.slug === 'super_admin');
}

export async function findAccountById(accountId: EntityId) {
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId)).limit(1);
  return account || null;
}

export async function findAccountMembership(accountId: EntityId, userId: EntityId) {
  const [membership] = await db
    .select({ membership: accountUsersTable, role: rolesTable })
    .from(accountUsersTable)
    .innerJoin(rolesTable, eq(accountUsersTable.roleId, rolesTable.id))
    .where(and(eq(accountUsersTable.accountId, accountId), eq(accountUsersTable.userId, userId)))
    .limit(1);
  return membership || null;
}

export async function getMembershipPermissions(roleId: EntityId) {
  const rows = await db
    .select({ slug: permissionsTable.slug })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, roleId));
  return new Set(rows.map((row) => row.slug));
}

export async function assertAccountAccess(accountId: EntityId, requester: any, mode: 'read' | 'write' = 'read', requiredPermission?: string) {
  const account = await findAccountById(accountId);
  if (!account) throw new ServiceError(404, 'Cuenta no encontrada');
  if (account.status !== 'active') throw new ServiceError(403, 'Cuenta sin acceso activo');
  if (isSuperAdmin(requester)) return { account, membership: null, roleSlug: 'super_admin' };

  const row = await findAccountMembership(accountId, parseEntityId(requester.id));
  if (!row || row.membership.status !== 'active') throw new ServiceError(403, 'Sin acceso a la cuenta');
  if (mode === 'write' && !['owner', 'admin'].includes(row.role.slug)) throw new ServiceError(403, 'Rol de cuenta insuficiente');
  if (requiredPermission) {
    const permissions = await getMembershipPermissions(row.role.id);
    if (!permissions.has(requiredPermission)) throw new ServiceError(403, `Permiso de cuenta requerido: ${requiredPermission}`);
  }
  return { account, membership: row.membership, roleSlug: row.role.slug };
}
