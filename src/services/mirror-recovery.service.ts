import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventModeRecoveryAccessTable } from '../db/schema.ts';
import { getMirrorContext } from './magic-mirror.service.ts';
import { parseEntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';

export async function getMirrorRecovery(eventId: unknown, modeId: unknown, requester: any) {
  const context = await getMirrorContext(eventId, modeId, requester, 'capture.operate');
  const [row] = await db.select().from(eventModeRecoveryAccessTable).where(eq(eventModeRecoveryAccessTable.eventModeId, context.eventModeId)).limit(1);
  return { verifier: row?.verifier ?? null, updatedAt: row?.updatedAt ?? null };
}

export async function setMirrorRecovery(eventId: unknown, modeId: unknown, pattern: unknown, requester: any) {
  // events.update requires an active owner/admin membership, not just capture access.
  const context = await getMirrorContext(eventId, modeId, requester, 'events.update');
  if (!Array.isArray(pattern) || pattern.length < 4 || pattern.length > 9 || new Set(pattern).size !== pattern.length || pattern.some(node => !Number.isInteger(node) || node < 0 || node > 8)) {
    throw new ServiceError(400, 'Patron no valido');
  }
  const verifier = await bcrypt.hash(pattern.join('-'), 12);
  const updatedAt = new Date();
  const values = { verifier, updatedAt, updatedBy: parseEntityId(requester.id) };
  await db.insert(eventModeRecoveryAccessTable).values({ eventModeId: context.eventModeId, ...values }).onDuplicateKeyUpdate({ set: values });
  return { configured: true, updatedAt };
}
