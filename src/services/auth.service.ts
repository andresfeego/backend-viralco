import { env } from '../lib/env.ts';
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
import { generateRandomToken, hashToken, hashPassword, verifyPassword } from './crypto.service.ts';
import { sendResetPasswordMailSimulated } from './mail.service.ts';
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} from './token.service.ts';
import {
  assignRoleToUser,
  buildAuthUser,
  createUser,
  findRoleBySlug,
  findUserByEmail,
  findUserById,
  sanitizeUser,
  updateUserPassword,
  updateUserThemeMode,
} from './user.service.ts';

function assertEmail(email: string) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Correo invalido');
  }
}

function assertPassword(password: string) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error('Contrasena invalida (minimo 8 caracteres)');
  }
}

async function issueSession(user: any) {
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = addDays(new Date(), env.refreshTokenTtlDays);

  await createRefreshTokenRecord(user.id, refreshTokenHash, refreshExpiresAt);

  const authUser = await buildAuthUser(user.id);
  if (!authUser) {
    throw new Error('No se pudo cargar usuario autenticado');
  }

  return {
    accessToken,
    refreshToken,
    user: authUser,
  };
}

export async function registerUser(input: any) {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');

  assertEmail(email);
  assertPassword(password);

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error('El correo ya esta registrado');
  }

  const role = await findRoleBySlug('admin');
  if (!role) {
    throw new Error('Rol admin no existe. Ejecuta seeds.');
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash, 'pending');
  if (!user) {
    throw new Error('No se pudo crear usuario');
  }

  await assignRoleToUser(user.id, role.id);

  return {
    user: sanitizeUser(user),
    message: 'Registro exitoso. Tu cuenta esta pendiente de aprobacion por Super Admin.',
  };
}

export async function loginUser(input: any) {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');

  assertEmail(email);
  assertPassword(password);

  const user = await findUserByEmail(email);
  if (!user) {
    throw new Error('Credenciales invalidas');
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    throw new Error('Credenciales invalidas');
  }

  return issueSession(user);
}

export async function refreshSession(refreshToken: string) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new Error('Refresh token requerido');
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded || decoded.tipo !== 'refresh' || !decoded.sub) {
    throw new Error('Refresh token invalido');
  }

  const refreshTokenHash = hashToken(refreshToken);
  const tokenRow = await findValidRefreshTokenRecord(refreshTokenHash);
  if (!tokenRow) {
    throw new Error('Refresh token invalido o revocado');
  }

  const user = await findUserById(Number(decoded.sub));
  if (!user) {
    throw new Error('Usuario no existe');
  }

  await revokeRefreshTokenByHash(refreshTokenHash);

  return issueSession(user);
}

export async function logoutUser(input: any, authUserId?: number) {
  const refreshToken = input?.refreshToken;

  if (refreshToken && typeof refreshToken === 'string') {
    await revokeRefreshTokenByHash(hashToken(refreshToken));
  }

  if (authUserId) {
    await revokeAllRefreshTokensByUserId(authUserId);
  }

  return { message: 'Sesion cerrada' };
}

export async function forgotPassword(input: any) {
  const email = String(input.email || '').trim().toLowerCase();
  assertEmail(email);

  const user = await findUserByEmail(email);

  if (!user) {
    return {
      message: 'Si el correo existe, recibiras instrucciones para recuperar contrasena.',
    };
  }

  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = addMinutes(new Date(), env.passwordResetTtlMinutes);

  await createPasswordResetTokenRecord(user.id, tokenHash, expiresAt);
  await sendResetPasswordMailSimulated(email, rawToken);

  return {
    message: 'Si el correo existe, recibiras instrucciones para recuperar contrasena.',
  };
}

export async function resetPassword(input: any) {
  const token = String(input.token || '').trim();
  const newPassword = String(input.newPassword || '');

  if (!token) {
    throw new Error('Token requerido');
  }

  assertPassword(newPassword);

  const tokenHash = hashToken(token);
  const tokenRow = await findValidPasswordResetToken(tokenHash);

  if (!tokenRow) {
    throw new Error('Token invalido o expirado');
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPassword(tokenRow.userId, passwordHash);
  await markPasswordResetTokenAsUsed(tokenRow.id);

  return { message: 'Contrasena actualizada correctamente.' };
}

export async function me(userId: number) {
  const authUser = await buildAuthUser(userId);
  if (!authUser) {
    throw new Error('Usuario no encontrado');
  }

  return authUser;
}

export async function updateMyThemeMode(userId: number, input: any) {
  const themeMode = String(input?.themeMode || '').trim().toLowerCase();
  if (themeMode !== 'dark' && themeMode !== 'light') {
    throw new Error('themeMode invalido. Usa dark o light');
  }

  await updateUserThemeMode(userId, themeMode as 'dark' | 'light');
  const authUser = await buildAuthUser(userId);
  if (!authUser) {
    throw new Error('Usuario no encontrado');
  }
  return authUser;
}
