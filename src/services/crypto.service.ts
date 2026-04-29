import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRandomToken(size = 48) {
  return crypto.randomBytes(size).toString('hex');
}
