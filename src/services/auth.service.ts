import { env } from '../lib/env.ts';
import { parseEntityId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { addDays, addMinutes } from '../lib/time.ts';
import {
  createPasswordResetTokenRecord,
  createRefreshTokenRecord,
  findValidPasswordResetToken,
  findValidRefreshTokenRecord,
  markPasswordResetTokenAsUsed,
  revokeAllRefreshTokensByUserId,
  revokeRefreshTokenByHash,
} from './auth-store.service.ts';
import { generateRandomToken, hashPassword, hashToken, verifyPassword } from './crypto.service.ts';
import { sendResetPasswordMailSimulated } from './mail.service.ts';
import { createAccessToken, createRefreshToken, verifyRefreshToken } from './token.service.ts';
import {
  buildAuthUser,
  createUser,
  findUserByEmail,
  findUserById,
  updateUserPassword,
  updateUserThemeMode,
} from './user.service.ts';

function assertEmail(email: string) {
  if (!email || !email.includes('@')) throw new ServiceError(400, 'Correo invalido');
}

function assertPassword(password: string) {
  if (!password || password.length < 8) throw new ServiceError(400, 'Contrasena invalida (minimo 8 caracteres)');
}

function assertName(name: string) {
  if (name.length < 2 || name.length > 180) throw new ServiceError(400, 'Nombre invalido');
}

async function assertActive(userId: EntityId) {
  const authUser = await buildAuthUser(userId);
  if (!authUser) throw new ServiceError(404, 'Usuario no existe');
  if (authUser.status.slug !== 'active') throw new ServiceError(403, 'Usuario sin acceso activo');
  return authUser;
}

async function issueSession(user: any) {
  await assertActive(user.id);
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);
  await createRefreshTokenRecord(user.id, hashToken(refreshToken), addDays(new Date(), env.refreshTokenTtlDays));
  const authUser = await buildAuthUser(user.id);
  return { accessToken, refreshToken, user: authUser };
}

export async function registerUser(input: any) {
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  const name = String(input?.name || '').trim();
  const phone = String(input?.phone || '').trim() || null;
  assertEmail(email);
  assertPassword(password);
  assertName(name);
  if (await findUserByEmail(email)) throw new ServiceError(409, 'El correo ya esta registrado');

  const user = await createUser({ email, password: await hashPassword(password), name, phone, statusSlug: 'active' });
  if (!user) throw new ServiceError(500, 'No se pudo crear usuario');
  return {
    user: await buildAuthUser(user.id),
    message: 'Registro exitoso. Ya puedes iniciar sesion y crear o unirte a una cuenta.',
  };
}

export async function loginUser(input: any) {
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  assertEmail(email);
  assertPassword(password);
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password))) throw new ServiceError(401, 'Credenciales invalidas');
  return issueSession(user);
}

export async function refreshSession(refreshToken: string) {
  if (!refreshToken) throw new ServiceError(400, 'Refresh token requerido');
  let decoded: any;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new ServiceError(401, 'Refresh token invalido');
  }
  if (decoded?.tipo !== 'refresh' || !decoded.sub) throw new ServiceError(401, 'Refresh token invalido');
  const tokenHash = hashToken(refreshToken);
  if (!(await findValidRefreshTokenRecord(tokenHash))) throw new ServiceError(401, 'Refresh token invalido o revocado');
  const userId = parseEntityId(decoded.sub, 'ID de usuario');
  const user = await findUserById(userId);
  if (!user) throw new ServiceError(404, 'Usuario no existe');
  await assertActive(user.id);
  await revokeRefreshTokenByHash(tokenHash);
  return issueSession(user);
}

export async function logoutUser(input: any, authUserId?: string) {
  const refreshToken = input?.refreshToken;
  if (typeof refreshToken === 'string' && refreshToken) await revokeRefreshTokenByHash(hashToken(refreshToken));
  if (authUserId) await revokeAllRefreshTokensByUserId(parseEntityId(authUserId));
  return { message: 'Sesion cerrada' };
}

export async function forgotPassword(input: any) {
  const email = String(input?.email || '').trim().toLowerCase();
  assertEmail(email);
  const user = await findUserByEmail(email);
  if (user) {
    const rawToken = generateRandomToken(32);
    await createPasswordResetTokenRecord(user.id, hashToken(rawToken), addMinutes(new Date(), env.passwordResetTtlMinutes));
    await sendResetPasswordMailSimulated(email, rawToken);
  }
  return { message: 'Si el correo existe, recibiras instrucciones para recuperar contrasena.' };
}

export async function resetPassword(input: any) {
  const token = String(input?.token || '').trim();
  const newPassword = String(input?.newPassword || '');
  if (!token) throw new ServiceError(400, 'Token requerido');
  assertPassword(newPassword);
  const row = await findValidPasswordResetToken(hashToken(token));
  if (!row) throw new ServiceError(400, 'Token invalido o expirado');
  await updateUserPassword(row.userId, await hashPassword(newPassword));
  await markPasswordResetTokenAsUsed(row.id);
  await revokeAllRefreshTokensByUserId(row.userId);
  return { message: 'Contrasena actualizada' };
}

export async function getMyProfile(userId: string) {
  const profile = await buildAuthUser(parseEntityId(userId));
  if (!profile) throw new ServiceError(404, 'Usuario no existe');
  return profile;
}

export async function updateMyTheme(userId: string, input: any) {
  const themeMode = String(input?.themeMode || '').trim().toLowerCase();
  if (themeMode !== 'dark' && themeMode !== 'light') throw new ServiceError(400, 'themeMode invalido. Usa dark o light');
  return updateUserThemeMode(parseEntityId(userId), themeMode);
}
