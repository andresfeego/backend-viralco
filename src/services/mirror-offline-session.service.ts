import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventModeConfigVersionsTable, eventModeSessionsTable } from '../db/schema.ts';
import { getMirrorContext, mapSession } from './magic-mirror.service.ts';
import { parseEntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { assertRuntimeBilling } from './offline-authorization.service.ts';

// Historical offline sessions do not take over the live session on another
// device. Their immutable version is retained for delayed uploads.
export async function registerOfflineMirrorSession(eventId: unknown, modeId: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventId, modeId, requester, 'capture.operate');
  const clientSessionId = String(input?.clientSessionId || '');
  const deviceInstallationId = String(input?.deviceInstallationId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSessionId) || !/^[A-Za-z0-9_.-]{3,120}$/.test(deviceInstallationId)) throw new ServiceError(400, 'Sesion offline invalida');
  const configVersionId = parseEntityId(input?.configVersionId);
  const startedAt = new Date(input?.startedAt);
  const through = new Date(input?.through || input?.startedAt);
  const now = new Date();
  await assertRuntimeBilling(context, requester, { clientSessionId, deviceInstallationId, startedBy: requester.id, status: 'running' });
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(through.getTime()) || through < startedAt || through.getTime() > now.getTime() + 300000) throw new ServiceError(400, 'Fecha de sesion invalida');
  const [version] = await db.select().from(eventModeConfigVersionsTable).where(and(eq(eventModeConfigVersionsTable.id, configVersionId), eq(eventModeConfigVersionsTable.eventModeId, context.eventModeId))).limit(1);
  if (!version) throw new ServiceError(404, 'Publicacion no encontrada');
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM event_modes WHERE id = ${context.eventModeId} FOR UPDATE`);
    const [existing] = await tx.select().from(eventModeSessionsTable).where(eq(eventModeSessionsTable.clientSessionId, clientSessionId)).limit(1);
    if (existing) {
      const metadata = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : existing.metadata;
      if (existing.eventModeId !== context.eventModeId || existing.configVersionId !== configVersionId || existing.deviceInstallationId !== deviceInstallationId || existing.startedBy !== parseEntityId(requester.id) || existing.status !== 'ended' || (metadata as any)?.offline !== true) throw new ServiceError(409, 'Sesion offline incompatible');
      const endedAt = new Date(Math.max(new Date(existing.endedAt).getTime(), through.getTime(), now.getTime()));
      await tx.update(eventModeSessionsTable).set({ endedAt, updatedAt: now }).where(eq(eventModeSessionsTable.id, existing.id));
      return mapSession({ ...existing, endedAt });
    }
    const result = await tx.insert(eventModeSessionsTable).values({ eventModeId: context.eventModeId, configVersionId, clientSessionId, deviceInstallationId, startedBy: parseEntityId(requester.id), status: 'ended', startedAt, endedAt: new Date(Math.max(now.getTime(), through.getTime())), metadata: { offline: true }, createdAt: now, updatedAt: now });
    const [created] = await tx.select().from(eventModeSessionsTable).where(eq(eventModeSessionsTable.id, BigInt(result[0]?.insertId || 0))).limit(1);
    return mapSession(created);
  });
}
