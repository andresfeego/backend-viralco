import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  accountsTable,
  accountUsersTable,
  permissionsTable,
  rolePermissionsTable,
  rolesTable,
  userRolesTable,
  userStatusesTable,
  usersTable,
} from '../db/schema.ts';
import { serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { getLibraryAssetWithVariants } from './library.service.ts';

export async function findUserStatusBySlug(slug: string) {
  const [status] = await db.select().from(userStatusesTable).where(eq(userStatusesTable.slug, slug)).limit(1);
  return status || null;
}

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  return user || null;
}

export async function findUserById(userId: EntityId) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user || null;
}

export async function findRoleBySlug(slug: string) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  return role || null;
}

export async function createUser(input: { email: string; password: string; name: string; phone?: string | null; statusSlug?: string }) {
  const status = await findUserStatusBySlug(input.statusSlug || 'pending');
  if (!status) throw new ServiceError(500, 'Catalogo de estados no inicializado');
  const now = new Date();
  const result = await db.insert(usersTable).values({
    email: input.email,
    password: input.password,
    name: input.name,
    phone: input.phone || null,
    statusId: status.id,
    themeMode: 'dark',
    createdAt: now,
    updatedAt: now,
  });
  const userId = BigInt(result[0]?.insertId || 0);
  if (!userId) throw new ServiceError(500, 'No se pudo crear el usuario');
  return findUserById(userId);
}

export async function assignGlobalRoleToUser(userId: EntityId, roleId: EntityId) {
  const [existing] = await db.select().from(userRolesTable)
    .where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.roleId, roleId))).limit(1);
  if (!existing) await db.insert(userRolesTable).values({ userId, roleId });
}

export async function getUserGlobalRoles(userId: EntityId) {
  return db.select({ id: rolesTable.id, slug: rolesTable.slug, name: rolesTable.name, description: rolesTable.description })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(eq(userRolesTable.userId, userId));
}

export async function getGlobalPermissions(userId: EntityId) {
  const rows = await db.select({ id: permissionsTable.id, slug: permissionsTable.slug, name: permissionsTable.name })
    .from(userRolesTable)
    .innerJoin(rolePermissionsTable, eq(userRolesTable.roleId, rolePermissionsTable.roleId))
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(userRolesTable.userId, userId));
  return Array.from(new Map(rows.map((row) => [row.slug, row])).values());
}

export const getUserPermissions = getGlobalPermissions;

export async function getUserAccounts(userId: EntityId) {
  const rows = await db.select({
    membershipId: accountUsersTable.id,
    membershipStatus: accountUsersTable.status,
    accountId: accountsTable.id,
    slug: accountsTable.slug,
    name: accountsTable.name,
    logoAssetId: accountsTable.logoAssetId,
    accountStatus: accountsTable.status,
    roleId: rolesTable.id,
    roleSlug: rolesTable.slug,
    roleName: rolesTable.name,
  }).from(accountUsersTable)
    .innerJoin(accountsTable, eq(accountUsersTable.accountId, accountsTable.id))
    .innerJoin(rolesTable, eq(accountUsersTable.roleId, rolesTable.id))
    .where(eq(accountUsersTable.userId, userId));

  return Promise.all(rows.map(async (row) => ({
    membershipId: serializeId(row.membershipId),
    status: row.membershipStatus,
    account: {
      id: serializeId(row.accountId),
      slug: row.slug,
      name: row.name,
      logoAssetId: serializeId(row.logoAssetId),
      logoAsset: await getLibraryAssetWithVariants(row.logoAssetId),
      status: row.accountStatus,
    },
    role: { id: serializeId(row.roleId), slug: row.roleSlug, name: row.roleName },
  })));
}

async function getStatus(statusId: EntityId) {
  const [status] = await db.select().from(userStatusesTable).where(eq(userStatusesTable.id, statusId)).limit(1);
  return status || null;
}

export async function buildAuthUser(userId: EntityId) {
  const user = await findUserById(userId);
  if (!user) return null;
  const [status, globalRoles, permissions, accounts] = await Promise.all([
    getStatus(user.statusId), getUserGlobalRoles(user.id), getGlobalPermissions(user.id), getUserAccounts(user.id),
  ]);
  if (!status) throw new ServiceError(500, 'Estado de usuario invalido');
  return {
    id: serializeId(user.id),
    email: user.email,
    name: user.name,
    phone: user.phone,
    themeMode: user.themeMode,
    status: { id: serializeId(status.id), slug: status.slug, name: status.name },
    globalRoles: globalRoles.map((role) => ({ ...role, id: serializeId(role.id) })),
    permissions: permissions.map((permission) => ({ ...permission, id: serializeId(permission.id) })),
    accounts,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function updateUserStatus(userId: EntityId, statusSlug: 'pending' | 'active' | 'suspended') {
  const status = await findUserStatusBySlug(statusSlug);
  if (!status) throw new ServiceError(404, 'Estado de usuario no encontrado');
  await db.update(usersTable).set({ statusId: status.id, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  return buildAuthUser(userId);
}

export async function updateUserPassword(userId: EntityId, passwordHash: string) {
  await db.update(usersTable).set({ password: passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, userId));
}

export async function updateUserThemeMode(userId: EntityId, themeMode: 'dark' | 'light') {
  await db.update(usersTable).set({ themeMode, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  return buildAuthUser(userId);
}

export async function userHasGlobalRole(userId: EntityId, roleSlug: string) {
  const [row] = await db.select({ roleId: rolesTable.id }).from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(and(eq(userRolesTable.userId, userId), eq(rolesTable.slug, roleSlug))).limit(1);
  return Boolean(row);
}

export async function listUsers() {
  const users = await db.select({ id: usersTable.id }).from(usersTable).orderBy(desc(usersTable.createdAt));
  return Promise.all(users.map((user) => buildAuthUser(user.id)));
}
