import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accountsTable, accountUsersTable, libraryAssetsTable, permissionsTable, rolePermissionsTable, rolesTable, usersTable } from '../db/schema.ts';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { assertAccountAccess, findAccountById, findAccountMembership, getMembershipPermissions, isSuperAdmin } from './account-access.service.ts';
import { getLibraryAssetWithVariants } from './library.service.ts';
import { createAccountSubscription, getLatestAccountSubscription } from './subscriptions.service.ts';
import { buildAuthUser, findRoleBySlug } from './user.service.ts';

const ACCOUNT_STATUSES = new Set(['active', 'suspended', 'canceled']);
const MEMBER_STATUSES = new Set(['active', 'suspended']);
const ASSIGNABLE_ROLES = new Set(['admin', 'operario', 'cliente']);

function normalizeOptionalEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError(400, 'Correo comercial invalido');
  return email;
}

function mapAccount(row: any, subscription?: any, logoAsset?: any) {
  return {
    id: serializeId(row.id), slug: row.slug, name: row.name, logoAssetId: serializeId(row.logoAssetId),
    logoAsset: logoAsset === undefined ? undefined : logoAsset,
    phone: row.phone, email: row.email, ownerUserId: serializeId(row.ownerUserId), status: row.status,
    subscription: subscription === undefined ? undefined : subscription,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function findAccountBySlug(slug: string) {
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.slug, slug)).limit(1);
  return account || null;
}

async function mapAccountWithSubscription(account: any) {
  const [subscription, logoAsset] = await Promise.all([
    getLatestAccountSubscription(account.id),
    getLibraryAssetWithVariants(account.logoAssetId),
  ]);
  return mapAccount(account, subscription, logoAsset);
}

async function assertLogoAssetAvailableForAccount(logoAssetId: EntityId | null, accountId: EntityId) {
  if (!logoAssetId) return null;
  const [asset] = await db.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, logoAssetId)).limit(1);
  if (!asset) throw new ServiceError(404, 'Logo no encontrado');
  if (asset.type !== 'logo') throw new ServiceError(400, 'El recurso debe ser de tipo logo');
  if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Logo no pertenece a la cuenta');
  if (asset.ownerType !== 'account' && asset.ownerType !== 'viralco') throw new ServiceError(400, 'Owner de logo invalido');
  return asset;
}

async function assertInitialLogoAsset(logoAssetId: EntityId | null) {
  if (!logoAssetId) return null;
  const [asset] = await db.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, logoAssetId)).limit(1);
  if (!asset) throw new ServiceError(404, 'Logo no encontrado');
  if (asset.type !== 'logo') throw new ServiceError(400, 'El recurso debe ser de tipo logo');
  if (asset.ownerType !== 'viralco') throw new ServiceError(400, 'En creacion inicial solo se permite un logo global');
  return asset;
}

export async function listAccounts(requester: any) {
  if (isSuperAdmin(requester)) {
    const rows = await db.select().from(accountsTable);
    return Promise.all(rows.map(mapAccountWithSubscription));
  }
  const rows = await db.select({ account: accountsTable }).from(accountUsersTable)
    .innerJoin(accountsTable, eq(accountUsersTable.accountId, accountsTable.id))
    .where(and(eq(accountUsersTable.userId, parseEntityId(requester.id)), eq(accountUsersTable.status, 'active')));
  return Promise.all(rows.map((row) => mapAccountWithSubscription(row.account)));
}

export async function getAccount(accountIdValue: unknown, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester);
  const account = await findAccountById(accountId);
  if (!account) throw new ServiceError(404, 'Cuenta no encontrada');
  return mapAccountWithSubscription(account);
}

async function createAccountRecord(input: any, requester: any, options: { ownerUserId?: EntityId; requireSuperAdmin: boolean; subscriptionStatus: string; subscriptionMetadata: any }) {
  if (options.requireSuperAdmin && !isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  const slug = String(input?.slug || '').trim().toLowerCase();
  const name = String(input?.name || '').trim();
  const ownerUserId = options.ownerUserId || parseEntityId(input?.ownerUserId, 'ID de propietario');
  const email = normalizeOptionalEmail(input?.email);
  const logoAssetId = input?.logoAssetId ? parseEntityId(input.logoAssetId, 'ID de logo') : null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new ServiceError(400, 'Slug invalido');
  if (!name) throw new ServiceError(400, 'Nombre de cuenta requerido');
  if (await findAccountBySlug(slug)) throw new ServiceError(409, 'El slug ya existe');
  await assertInitialLogoAsset(logoAssetId);
  const owner = await buildAuthUser(ownerUserId);
  if (!owner) throw new ServiceError(404, 'Propietario no encontrado');
  if (owner.status.slug !== 'active') throw new ServiceError(409, 'El propietario debe estar activo');
  const ownerRole = await findRoleBySlug('owner');
  if (!ownerRole) throw new ServiceError(500, 'Rol owner no inicializado');
  const now = new Date();

  return db.transaction(async (tx) => {
    const result = await tx.insert(accountsTable).values({
      slug, name, logoAssetId,
      phone: String(input?.phone || '').trim() || null, email, ownerUserId, status: 'active', createdAt: now, updatedAt: now,
    });
    const accountId = BigInt(result[0]?.insertId || 0);
    await tx.insert(accountUsersTable).values({
      accountId, userId: ownerUserId, roleId: ownerRole.id, status: 'active',
      invitedBy: parseEntityId(requester.id), invitedAt: now, joinedAt: now, createdAt: now, updatedAt: now,
    });
    const subscription = await createAccountSubscription({ accountId, planSlug: input?.planSlug || 'starter', status: options.subscriptionStatus, metadata: options.subscriptionMetadata }, tx);
    return mapAccount({
      id: accountId, slug, name, logoAssetId,
      phone: String(input?.phone || '').trim() || null, email, ownerUserId, status: 'active', createdAt: now, updatedAt: now,
    }, subscription, null);
  });
}

export async function createAccount(input: any, requester: any) {
  return createAccountRecord(input, requester, { requireSuperAdmin: true, subscriptionStatus: 'active', subscriptionMetadata: { createdByAdmin: true } });
}

export async function createSelfServiceAccount(input: any, requester: any) {
  return createAccountRecord(input, requester, { ownerUserId: parseEntityId(requester.id), requireSuperAdmin: false, subscriptionStatus: 'trialing', subscriptionMetadata: { simulatedCheckout: true } });
}

export async function updateAccount(accountIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'read', 'accounts.update');
  const current = await findAccountById(accountId);
  if (!current) throw new ServiceError(404, 'Cuenta no encontrada');
  const name = input?.name === undefined ? current.name : String(input.name).trim();
  if (!name) throw new ServiceError(400, 'Nombre de cuenta requerido');
  const logoAssetId = input?.logoAssetId === undefined ? current.logoAssetId : (input.logoAssetId ? parseEntityId(input.logoAssetId, 'ID de logo') : null);
  await assertLogoAssetAvailableForAccount(logoAssetId, accountId);
  await db.update(accountsTable).set({
    name,
    logoAssetId,
    phone: input?.phone === undefined ? current.phone : String(input.phone || '').trim() || null,
    email: input?.email === undefined ? current.email : normalizeOptionalEmail(input.email),
    updatedAt: new Date(),
  }).where(eq(accountsTable.id, accountId));
  return mapAccountWithSubscription(await findAccountById(accountId));
}

export async function updateAccountStatus(accountIdValue: unknown, statusValue: unknown, requester: any) {
  if (!isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  const status = String(statusValue || '').trim();
  if (!ACCOUNT_STATUSES.has(status)) throw new ServiceError(400, 'Estado de cuenta invalido');
  if (!(await findAccountById(accountId))) throw new ServiceError(404, 'Cuenta no encontrada');
  await db.update(accountsTable).set({ status, updatedAt: new Date() }).where(eq(accountsTable.id, accountId));
  return mapAccountWithSubscription(await findAccountById(accountId));
}

export async function listMembers(accountIdValue: unknown, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'read', 'accounts.members.manage');
  const rows = await db.select({ membership: accountUsersTable, user: usersTable, role: rolesTable })
    .from(accountUsersTable).innerJoin(usersTable, eq(accountUsersTable.userId, usersTable.id))
    .innerJoin(rolesTable, eq(accountUsersTable.roleId, rolesTable.id))
    .where(eq(accountUsersTable.accountId, accountId));
  return rows.map(({ membership, user, role }) => ({
    id: serializeId(membership.id), status: membership.status,
    user: { id: serializeId(user.id), email: user.email, name: user.name },
    role: { id: serializeId(role.id), slug: role.slug, name: role.name },
    invitedBy: serializeId(membership.invitedBy), invitedAt: membership.invitedAt,
    joinedAt: membership.joinedAt, createdAt: membership.createdAt, updatedAt: membership.updatedAt,
  }));
}

export async function addMember(accountIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'read', 'accounts.members.manage');
  const userId = parseEntityId(input?.userId, 'ID de usuario');
  const roleSlug = String(input?.roleSlug || '').trim();
  if (!ASSIGNABLE_ROLES.has(roleSlug)) throw new ServiceError(400, 'Rol de cuenta invalido');
  if (await findAccountMembership(accountId, userId)) throw new ServiceError(409, 'El usuario ya pertenece a la cuenta');
  const user = await buildAuthUser(userId);
  if (!user) throw new ServiceError(404, 'Usuario no encontrado');
  if (user.status.slug !== 'active') throw new ServiceError(409, 'El usuario debe estar activo');
  const role = await findRoleBySlug(roleSlug);
  if (!role) throw new ServiceError(404, 'Rol no encontrado');
  const now = new Date();
  await db.insert(accountUsersTable).values({
    accountId, userId, roleId: role.id, status: 'active', invitedBy: parseEntityId(requester.id),
    invitedAt: now, joinedAt: now, createdAt: now, updatedAt: now,
  });
  return listMembers(accountId, requester);
}

async function assertCanChangeOwnerMembership(accountId: EntityId, membership: any, patch: any, deleting = false) {
  const ownerRole = await findRoleBySlug('owner');
  if (!ownerRole || membership.roleId !== ownerRole.id) return;
  const willStopBeingActiveOwner = deleting || patch.status === 'suspended' || (patch.roleId && patch.roleId !== ownerRole.id);
  if (!willStopBeingActiveOwner) return;
  const activeOwners = await db.select().from(accountUsersTable)
    .where(and(eq(accountUsersTable.accountId, accountId), eq(accountUsersTable.roleId, ownerRole.id), eq(accountUsersTable.status, 'active'), ne(accountUsersTable.id, membership.id)));
  if (activeOwners.length === 0) throw new ServiceError(409, 'No se puede dejar la cuenta sin owner activo');
}

export async function updateMember(accountIdValue: unknown, membershipIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  const membershipId = parseEntityId(membershipIdValue, 'ID de membresia');
  await assertAccountAccess(accountId, requester, 'read', 'accounts.members.manage');
  const [membership] = await db.select().from(accountUsersTable)
    .where(and(eq(accountUsersTable.id, membershipId), eq(accountUsersTable.accountId, accountId))).limit(1);
  if (!membership) throw new ServiceError(404, 'Membresia no encontrada');
  const patch: any = { updatedAt: new Date() };
  if (input?.status !== undefined) {
    const status = String(input.status);
    if (!MEMBER_STATUSES.has(status)) throw new ServiceError(400, 'Estado de membresia invalido');
    patch.status = status;
  }
  if (input?.roleSlug !== undefined) {
    const roleSlug = String(input.roleSlug);
    if (!ASSIGNABLE_ROLES.has(roleSlug)) throw new ServiceError(400, 'Rol de cuenta invalido');
    const role = await findRoleBySlug(roleSlug);
    if (!role) throw new ServiceError(404, 'Rol no encontrado');
    patch.roleId = role.id;
  }
  await assertCanChangeOwnerMembership(accountId, membership, patch);
  await db.update(accountUsersTable).set(patch).where(eq(accountUsersTable.id, membershipId));
  return listMembers(accountId, requester);
}

export async function removeMember(accountIdValue: unknown, membershipIdValue: unknown, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  const membershipId = parseEntityId(membershipIdValue, 'ID de membresia');
  await assertAccountAccess(accountId, requester, 'read', 'accounts.members.manage');
  const [membership] = await db.select().from(accountUsersTable)
    .where(and(eq(accountUsersTable.id, membershipId), eq(accountUsersTable.accountId, accountId))).limit(1);
  if (!membership) throw new ServiceError(404, 'Membresia no encontrada');
  await assertCanChangeOwnerMembership(accountId, membership, {}, true);
  await db.delete(accountUsersTable).where(eq(accountUsersTable.id, membershipId));
  return { deleted: true };
}
