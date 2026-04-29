import jwt from 'jsonwebtoken';
import { env } from '../lib/env.ts';

export function createAccessToken(user: any) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      tipo: 'access',
    },
    env.accessTokenSecret,
    { expiresIn: env.accessTokenTtl }
  );
}

export function createRefreshToken(user: any) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      tipo: 'refresh',
    },
    env.refreshTokenSecret,
    { expiresIn: `${env.refreshTokenTtlDays}d` }
  );
}

export function createSuperAdminConfirmToken(userId: number) {
  return jwt.sign(
    {
      sub: String(userId),
      tipo: 'super_admin_confirm',
    },
    env.superAdminConfirmSecret,
    { expiresIn: env.superAdminConfirmTtl }
  );
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.accessTokenSecret) as any;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.refreshTokenSecret) as any;
}

export function verifySuperAdminConfirmToken(token: string) {
  return jwt.verify(token, env.superAdminConfirmSecret) as any;
}
