import { parseEntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { revokeAllRefreshTokensByUserId } from './auth-store.service.ts';
import { hashPassword } from './crypto.service.ts';
import { buildAuthUser, createUser, findUserByEmail, listUsers, updateUserStatus, userHasGlobalRole } from './user.service.ts';

export async function listAdminUsers() {
  return (await listUsers()).filter(Boolean);
}

async function assertNotSuperAdmin(userId: bigint) {
  if (await userHasGlobalRole(userId, 'super_admin')) throw new ServiceError(409, 'No se permite modificar un Super Admin');
}

export async function changeUserStatus(userIdValue: unknown, statusSlugValue: unknown) {
  const userId = parseEntityId(userIdValue, 'ID de usuario');
  const statusSlug = String(statusSlugValue || '').trim() as 'pending' | 'active' | 'suspended';
  if (!['pending', 'active', 'suspended'].includes(statusSlug)) throw new ServiceError(400, 'Estado de usuario invalido');
  await assertNotSuperAdmin(userId);
  const user = await updateUserStatus(userId, statusSlug);
  if (!user) throw new ServiceError(404, 'Usuario no encontrado');
  if (statusSlug === 'suspended') await revokeAllRefreshTokensByUserId(userId);
  return user;
}

export async function activateUser(userId: unknown) {
  return changeUserStatus(userId, 'active');
}

export async function deactivateUser(userId: unknown) {
  return changeUserStatus(userId, 'suspended');
}

export async function createAdminUser(input: any) {
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  const name = String(input?.name || '').trim();
  const phone = String(input?.phone || '').trim() || null;
  if (!email.includes('@')) throw new ServiceError(400, 'Correo invalido');
  if (password.length < 8) throw new ServiceError(400, 'Contrasena invalida (minimo 8 caracteres)');
  if (name.length < 2) throw new ServiceError(400, 'Nombre invalido');
  if (await findUserByEmail(email)) throw new ServiceError(409, 'El correo ya esta registrado');
  const user = await createUser({ email, password: await hashPassword(password), name, phone, statusSlug: 'pending' });
  if (!user) throw new ServiceError(500, 'No se pudo crear usuario');
  return buildAuthUser(user.id);
}
