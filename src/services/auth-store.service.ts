import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { passwordResetTokensTable, refreshTokensTable } from '../db/schema.ts';

export async function createRefreshTokenRecord(userId: number, token: string, expiresAt: Date) {
  await db.insert(refreshTokensTable).values({
    userId,
    token,
    expiresAt,
    revoked: false,
  });
}

export async function findValidRefreshTokenRecord(tokenHash: string) {
  const now = new Date();
  const [token] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.token, tokenHash),
        eq(refreshTokensTable.revoked, false),
        gt(refreshTokensTable.expiresAt, now)
      )
    )
    .limit(1);

  return token || null;
}

export async function revokeRefreshTokenByHash(tokenHash: string) {
  await db
    .update(refreshTokensTable)
    .set({ revoked: true })
    .where(eq(refreshTokensTable.token, tokenHash));
}

export async function revokeAllRefreshTokensByUserId(userId: number) {
  await db.update(refreshTokensTable).set({ revoked: true }).where(eq(refreshTokensTable.userId, userId));
}

export async function createPasswordResetTokenRecord(userId: number, tokenHash: string, expiresAt: Date) {
  await db
    .update(passwordResetTokensTable)
    .set({ used: true })
    .where(and(eq(passwordResetTokensTable.userId, userId), eq(passwordResetTokensTable.used, false)));

  await db.insert(passwordResetTokensTable).values({
    userId,
    token: tokenHash,
    expiresAt,
    used: false,
  });
}

export async function findValidPasswordResetToken(tokenHash: string) {
  const now = new Date();
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.token, tokenHash),
        eq(passwordResetTokensTable.used, false),
        gt(passwordResetTokensTable.expiresAt, now)
      )
    )
    .limit(1);

  return row || null;
}

export async function markPasswordResetTokenAsUsed(id: number) {
  await db.update(passwordResetTokensTable).set({ used: true }).where(eq(passwordResetTokensTable.id, id));
}
