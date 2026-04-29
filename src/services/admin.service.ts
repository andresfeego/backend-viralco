import { assignRoleToUser, createUser, findRoleBySlug, findUserByEmail, listUsersByRole, sanitizeUser, updateUserEstado, userHasRole } from './user.service.ts';
import { hashPassword } from './crypto.service.ts';

export async function listAdminUsers() {
  const rows = await listUsersByRole('admin');
  return rows.map(sanitizeUser);
}

async function assertNotSuperAdmin(userId: number) {
  const isSuperAdmin = await userHasRole(userId, 'super_admin');
  if (isSuperAdmin) {
    throw new Error('No se permite modificar estado de un Super Admin');
  }
}

export async function activateUser(userId: number) {
  await assertNotSuperAdmin(userId);
  const user = await updateUserEstado(userId, 'active');
  if (!user) {
    throw new Error('Usuario no encontrado');
  }
  return sanitizeUser(user);
}

export async function deactivateUser(userId: number) {
  await assertNotSuperAdmin(userId);
  const user = await updateUserEstado(userId, 'inactive');
  if (!user) {
    throw new Error('Usuario no encontrado');
  }
  return sanitizeUser(user);
}

export async function createAdminUser(input: any) {
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');

  if (!email || !email.includes('@')) {
    throw new Error('Correo invalido');
  }
  if (!password || password.length < 8) {
    throw new Error('Contrasena invalida (minimo 8 caracteres)');
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('El correo ya esta registrado');
  }

  const adminRole = await findRoleBySlug('admin');
  if (!adminRole) {
    throw new Error('Rol admin no existe. Ejecuta seeds.');
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash, 'pending');
  if (!user) {
    throw new Error('No se pudo crear usuario admin');
  }
  await assignRoleToUser(user.id, adminRole.id);
  return sanitizeUser(user);
}
