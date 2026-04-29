import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  permissionsTable,
  rolePermissionsTable,
  rolesTable,
  userRolesTable,
  usersTable,
} from '../db/schema.ts';

const ESTADO_ID_BY_SLUG: Record<string, number> = {
  pending: 1,
  active: 2,
  inactive: 3,
};

export function sanitizeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    estado: user.estado,
    estadoId: user.estadoId,
    themeMode: user.themeMode,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  return user || null;
}

export async function findUserById(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user || null;
}

export async function findRoleBySlug(slug: string) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  return role || null;
}

export async function createUser(email: string, password: string, estado = 'pending') {
  const now = new Date();
  const estadoId = ESTADO_ID_BY_SLUG[estado] || 1;
  const result = await db.insert(usersTable).values({
    email,
    password,
    estado: estado as any,
    estadoId,
    themeMode: 'dark' as any,
    createdAt: now,
    updatedAt: now,
  });

  const userId = Number(result[0]?.insertId || 0);
  if (!userId) {
    throw new Error('No se pudo crear el usuario');
  }

  return findUserById(userId);
}

export async function assignRoleToUser(userId: number, roleId: number) {
  const [existing] = await db
    .select()
    .from(userRolesTable)
    .where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.roleId, roleId)))
    .limit(1);

  if (!existing) {
    await db.insert(userRolesTable).values({ userId, roleId });
  }
}

export async function getUserRoles(userId: number) {
  const rows = await db
    .select({
      id: rolesTable.id,
      slug: rolesTable.slug,
      name: rolesTable.name,
    })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(eq(userRolesTable.userId, userId));

  return rows;
}

export async function getUserPermissions(userId: number) {
  const rows = await db
    .select({
      id: permissionsTable.id,
      slug: permissionsTable.slug,
      name: permissionsTable.name,
    })
    .from(userRolesTable)
    .innerJoin(rolePermissionsTable, eq(userRolesTable.roleId, rolePermissionsTable.roleId))
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(userRolesTable.userId, userId));

  const dedup = new Map<string, any>();
  for (const row of rows) {
    dedup.set(row.slug, row);
  }

  return Array.from(dedup.values());
}

export async function buildAuthUser(userId: number) {
  const user = await findUserById(userId);
  if (!user) {
    return null;
  }

  const roles = await getUserRoles(user.id);
  const permissions = await getUserPermissions(user.id);

  return {
    ...sanitizeUser(user),
    roles,
    permissions,
  };
}

export async function updateUserEstado(userId: number, estado: 'pending' | 'active' | 'inactive') {
  await db
    .update(usersTable)
    .set({ estado, estadoId: ESTADO_ID_BY_SLUG[estado], updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  return findUserById(userId);
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  await db
    .update(usersTable)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

export async function updateUserThemeMode(userId: number, themeMode: 'dark' | 'light') {
  await db
    .update(usersTable)
    .set({ themeMode: themeMode as any, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  return findUserById(userId);
}

export async function userHasRole(userId: number, roleSlug: string) {
  const [row] = await db
    .select({ roleId: rolesTable.id })
    .from(userRolesTable)
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
    .where(and(eq(userRolesTable.userId, userId), eq(rolesTable.slug, roleSlug)))
    .limit(1);

  return Boolean(row);
}

export async function listUsersByRole(roleSlug: string) {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      estado: usersTable.estado,
      estadoId: usersTable.estadoId,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .innerJoin(userRolesTable, eq(userRolesTable.userId, usersTable.id))
    .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
    .where(eq(rolesTable.slug, roleSlug))
    .orderBy(desc(usersTable.createdAt));

  return rows;
}
