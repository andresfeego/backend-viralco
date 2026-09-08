import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  assetEventResourcesTable,
  assetsTable,
  deliveriesTable,
  eventModeSessionsTable,
  eventResourcesTable,
  mirrorCaptureRunsTable,
  mirrorCapturesTable,
} from '../db/schema.ts';
import { parseEntityId, serializeId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import {
  assertRuntimeUploadInput,
  buildMirrorRuntimeKey,
  createPresignedReadUrl,
  createPresignedRuntimeUpload,
  headR2Object,
  r2PublicUrl,
} from '../r2.ts';
import { getMirrorContext, mapSession } from './magic-mirror.service.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_STATUSES = new Set(['capturing', 'reviewing', 'processing', 'processed', 'synced', 'failed', 'abandoned']);

function parseJson(value: any) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function assertUuid(value: unknown, label: string) {
  const parsed = String(value || '').trim();
  if (!UUID_PATTERN.test(parsed)) throw new ServiceError(400, `${label} debe ser UUID`);
  return parsed;
}

function publicHash() {
  return randomBytes(19).toString('base64url').slice(0, 25);
}

function mapRun(row: any) {
  return {
    id: serializeId(row.id), sessionId: serializeId(row.eventModeSessionId), clientRunId: row.clientRunId,
    status: row.status, startedAt: row.startedAt, completedAt: row.completedAt, failureCode: row.failureCode,
    metadata: parseJson(row.metadata), updatedAt: row.updatedAt,
  };
}

function mapCapture(row: any) {
  return {
    id: serializeId(row.id), runId: serializeId(row.captureRunId), clientCaptureId: row.clientCaptureId,
    photoNumber: row.photoNumber, attempt: row.attempt, status: row.status, mimeType: row.mimeType,
    sizeBytes: serializeId(row.sizeBytes), sha256: row.sha256, capturedAt: row.capturedAt,
    uploadedAt: row.uploadedAt, metadata: parseJson(row.metadata), updatedAt: row.updatedAt,
  };
}

function mapAsset(row: any) {
  return {
    id: serializeId(row.id), publicHash: row.publicHash, clientAssetId: row.clientAssetId,
    eventId: serializeId(row.eventId), eventModeId: serializeId(row.eventModeId),
    sessionId: serializeId(row.eventModeSessionId), runId: serializeId(row.captureRunId),
    type: row.type, status: row.status, mimeType: row.mimeType, sizeBytes: serializeId(row.sizeBytes),
    sha256: row.sha256, metadata: parseJson(row.metadata), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function runtimeContext(eventIdValue: unknown, eventModeIdValue: unknown, sessionIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'capture.operate');
  const sessionId = parseEntityId(sessionIdValue, 'ID de sesion');
  const [session] = await db.select().from(eventModeSessionsTable).where(and(
    eq(eventModeSessionsTable.id, sessionId),
    eq(eventModeSessionsTable.eventModeId, context.eventModeId),
  )).limit(1);
  if (!session) throw new ServiceError(404, 'Sesion no encontrada');
  return { ...context, session };
}

async function runForContext(context: any, runIdValue: unknown) {
  const runId = parseEntityId(runIdValue, 'ID de experiencia');
  const [run] = await db.select().from(mirrorCaptureRunsTable).where(and(
    eq(mirrorCaptureRunsTable.id, runId),
    eq(mirrorCaptureRunsTable.eventModeSessionId, context.session.id),
  )).limit(1);
  if (!run) throw new ServiceError(404, 'Experiencia no encontrada');
  return run;
}

function sessionAcceptsRun(session: any, startedAt: Date) {
  if (['preparing', 'running'].includes(session.status)) return true;
  return Boolean(session.endedAt && startedAt.getTime() <= new Date(session.endedAt).getTime());
}

export async function createMirrorCaptureRun(eventId: unknown, eventModeId: unknown, sessionId: unknown, input: any, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const clientRunId = assertUuid(input?.clientRunId, 'clientRunId');
  const [existing] = await db.select().from(mirrorCaptureRunsTable).where(eq(mirrorCaptureRunsTable.clientRunId, clientRunId)).limit(1);
  if (existing) {
    if (existing.eventModeSessionId !== context.session.id) throw new ServiceError(409, 'clientRunId pertenece a otra sesion');
    return mapRun(existing);
  }
  const startedAt = input?.startedAt ? new Date(input.startedAt) : new Date();
  if (Number.isNaN(startedAt.getTime())) throw new ServiceError(400, 'startedAt invalido');
  if (!sessionAcceptsRun(context.session, startedAt)) throw new ServiceError(409, 'La sesion ya no acepta nuevas experiencias');
  const now = new Date();
  const result = await db.insert(mirrorCaptureRunsTable).values({
    eventModeSessionId: context.session.id, clientRunId, status: 'capturing', startedAt,
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : null,
    createdAt: now, updatedAt: now,
  });
  const [created] = await db.select().from(mirrorCaptureRunsTable).where(eq(mirrorCaptureRunsTable.id, BigInt(result[0]?.insertId || 0))).limit(1);
  return mapRun(created);
}

export async function updateMirrorCaptureRun(eventId: unknown, eventModeId: unknown, sessionId: unknown, runId: unknown, input: any, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const run = await runForContext(context, runId);
  const status = String(input?.status || '');
  if (!RUN_STATUSES.has(status)) throw new ServiceError(400, 'Estado de experiencia invalido');
  const terminal = ['synced', 'failed', 'abandoned'].includes(status);
  const now = new Date();
  await db.update(mirrorCaptureRunsTable).set({
    status, completedAt: terminal ? now : run.completedAt,
    failureCode: status === 'failed' ? String(input?.failureCode || 'UNKNOWN').slice(0, 80) : run.failureCode,
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : run.metadata,
    updatedAt: now,
  }).where(eq(mirrorCaptureRunsTable.id, run.id));
  return mapRun({ ...run, status, completedAt: terminal ? now : run.completedAt, updatedAt: now });
}

async function runtimeUpload(accountId: string, eventId: string, sessionId: string, kind: 'captures' | 'deliverables', clientId: string, input: any) {
  const file = assertRuntimeUploadInput(input);
  const key = buildMirrorRuntimeKey({ accountId, eventId, sessionId, kind, clientId, contentType: file.contentType });
  return { file, key, upload: await createPresignedRuntimeUpload({ key, contentType: file.contentType, sha256: file.sha256 }) };
}

export async function prepareMirrorCapture(eventId: unknown, eventModeId: unknown, sessionId: unknown, runId: unknown, input: any, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const run = await runForContext(context, runId);
  const clientCaptureId = assertUuid(input?.clientCaptureId, 'clientCaptureId');
  const photoNumber = Number(input?.photoNumber);
  const attempt = Number(input?.attempt || 1);
  if (!Number.isInteger(photoNumber) || photoNumber < 1 || photoNumber > 8) throw new ServiceError(400, 'Numero de toma invalido');
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 99) throw new ServiceError(400, 'Intento de toma invalido');
  const prepared = await runtimeUpload(serializeId(context.event.accountId)!, serializeId(context.eventId)!, serializeId(context.session.id)!, 'captures', clientCaptureId, input);
  const [existing] = await db.select().from(mirrorCapturesTable).where(eq(mirrorCapturesTable.clientCaptureId, clientCaptureId)).limit(1);
  let capture = existing;
  const now = new Date();
  if (existing) {
    if (existing.captureRunId !== run.id) throw new ServiceError(409, 'clientCaptureId pertenece a otra experiencia');
    await db.update(mirrorCapturesTable).set({ storageKey: prepared.key, mimeType: prepared.file.contentType, sizeBytes: BigInt(prepared.file.sizeBytes), sha256: prepared.file.sha256, status: existing.status === 'synced' ? 'synced' : 'uploading', updatedAt: now }).where(eq(mirrorCapturesTable.id, existing.id));
    capture = { ...existing, storageKey: prepared.key, mimeType: prepared.file.contentType, sizeBytes: BigInt(prepared.file.sizeBytes), sha256: prepared.file.sha256, status: existing.status === 'synced' ? 'synced' : 'uploading', updatedAt: now };
  } else {
    const capturedAt = input?.capturedAt ? new Date(input.capturedAt) : now;
    if (Number.isNaN(capturedAt.getTime())) throw new ServiceError(400, 'capturedAt invalido');
    const result = await db.insert(mirrorCapturesTable).values({ captureRunId: run.id, clientCaptureId, photoNumber, attempt, status: 'uploading', storageKey: prepared.key, mimeType: prepared.file.contentType, sizeBytes: BigInt(prepared.file.sizeBytes), sha256: prepared.file.sha256, capturedAt, metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : null, createdAt: now, updatedAt: now });
    [capture] = await db.select().from(mirrorCapturesTable).where(eq(mirrorCapturesTable.id, BigInt(result[0]?.insertId || 0))).limit(1);
  }
  return { capture: mapCapture(capture), upload: capture.status === 'synced' ? null : prepared.upload };
}

export async function completeMirrorCapture(eventId: unknown, eventModeId: unknown, sessionId: unknown, runId: unknown, captureId: unknown, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const run = await runForContext(context, runId);
  const id = parseEntityId(captureId, 'ID de toma');
  const [capture] = await db.select().from(mirrorCapturesTable).where(and(eq(mirrorCapturesTable.id, id), eq(mirrorCapturesTable.captureRunId, run.id))).limit(1);
  if (!capture) throw new ServiceError(404, 'Toma no encontrada');
  if (capture.status === 'synced') return mapCapture(capture);
  const stored = await headR2Object(String(capture.storageKey || ''));
  if (stored.sizeBytes !== Number(capture.sizeBytes) || stored.sha256 !== capture.sha256) throw new ServiceError(409, JSON.stringify({ code: 'RUNTIME_UPLOAD_MISMATCH', message: 'El archivo subido no coincide con la toma local' }));
  const now = new Date();
  await db.update(mirrorCapturesTable).set({ status: 'synced', uploadedAt: now, updatedAt: now }).where(eq(mirrorCapturesTable.id, capture.id));
  return mapCapture({ ...capture, status: 'synced', uploadedAt: now, updatedAt: now });
}

export async function prepareMirrorAsset(eventId: unknown, eventModeId: unknown, sessionId: unknown, runId: unknown, input: any, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const run = await runForContext(context, runId);
  const clientAssetId = assertUuid(input?.clientAssetId, 'clientAssetId');
  const hasFile = input?.contentType || input?.sizeBytes || input?.sha256;
  const prepared = hasFile ? await runtimeUpload(serializeId(context.event.accountId)!, serializeId(context.eventId)!, serializeId(context.session.id)!, 'deliverables', clientAssetId, input) : null;
  const [existing] = await db.select().from(assetsTable).where(eq(assetsTable.clientAssetId, clientAssetId)).limit(1);
  let asset = existing;
  const now = new Date();
  const status = prepared ? 'uploading' : 'processing';
  const resourceIds = Array.isArray(input?.eventResourceIds)
    ? [...new Set(input.eventResourceIds.map(String).filter((value: string) => /^\d+$/.test(value)))]
    : [];
  if (resourceIds.length) {
    const rows = await db.select().from(eventResourcesTable).where(and(
      eq(eventResourcesTable.eventId, context.eventId),
      eq(eventResourcesTable.eventModeId, context.eventModeId),
      eq(eventResourcesTable.isActive, true),
    ));
    const allowed = new Set(rows
      .filter((row) => resourceIds.includes(serializeId(row.id)!))
      .map((row) => serializeId(row.id)!));
    if (allowed.size !== resourceIds.length) throw new ServiceError(400, 'Uno de los recursos aplicados no pertenece al modo activo');
  }
  if (existing) {
    if (existing.captureRunId !== run.id) throw new ServiceError(409, 'clientAssetId pertenece a otra experiencia');
    if (prepared && existing.status !== 'synced') {
      await db.update(assetsTable).set({ status, storageKey: prepared.key, fileUrl: r2PublicUrl(prepared.key), mimeType: prepared.file.contentType, sizeBytes: BigInt(prepared.file.sizeBytes), sha256: prepared.file.sha256, updatedAt: now }).where(eq(assetsTable.id, existing.id));
      asset = { ...existing, status, storageKey: prepared.key, fileUrl: r2PublicUrl(prepared.key), mimeType: prepared.file.contentType, sizeBytes: BigInt(prepared.file.sizeBytes), sha256: prepared.file.sha256, updatedAt: now };
    }
  } else {
    const result = await db.insert(assetsTable).values({ publicHash: publicHash(), clientAssetId, eventId: context.eventId, eventModeId: context.eventModeId, eventModeSessionId: context.session.id, captureRunId: run.id, type: 'photo', status, storageKey: prepared?.key || null, fileUrl: prepared ? r2PublicUrl(prepared.key) : null, mimeType: prepared?.file.contentType || null, sizeBytes: prepared ? BigInt(prepared.file.sizeBytes) : null, sha256: prepared?.file.sha256 || null, metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : null, createdAt: now, updatedAt: now });
    [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, BigInt(result[0]?.insertId || 0))).limit(1);
    if (resourceIds.length) {
      await db.insert(assetEventResourcesTable).values(resourceIds.map((id: string, index: number) => ({ assetId: asset.id, eventResourceId: parseEntityId(id), orderIndex: index, createdAt: now })));
    }
  }
  return { asset: mapAsset(asset), upload: asset.status === 'synced' ? null : prepared?.upload || null };
}

export async function completeMirrorAsset(eventId: unknown, eventModeId: unknown, sessionId: unknown, runId: unknown, assetId: unknown, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const run = await runForContext(context, runId);
  const id = parseEntityId(assetId, 'ID de entregable');
  const [asset] = await db.select().from(assetsTable).where(and(eq(assetsTable.id, id), eq(assetsTable.captureRunId, run.id))).limit(1);
  if (!asset) throw new ServiceError(404, 'Entregable no encontrado');
  if (asset.status === 'synced') return { asset: mapAsset(asset), downloadUrl: await createPresignedReadUrl(String(asset.storageKey || '')) };
  const stored = await headR2Object(String(asset.storageKey || ''));
  if (stored.sizeBytes !== Number(asset.sizeBytes) || stored.sha256 !== asset.sha256) throw new ServiceError(409, JSON.stringify({ code: 'RUNTIME_UPLOAD_MISMATCH', message: 'El archivo subido no coincide con el entregable local' }));
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(assetsTable).set({ status: 'synced', updatedAt: now }).where(eq(assetsTable.id, asset.id));
    await tx.update(mirrorCaptureRunsTable).set({ status: 'synced', completedAt: now, updatedAt: now }).where(eq(mirrorCaptureRunsTable.id, run.id));
  });
  return { asset: mapAsset({ ...asset, status: 'synced', updatedAt: now }), downloadUrl: await createPresignedReadUrl(String(asset.storageKey || '')) };
}

export async function getPublicMirrorAsset(publicHashValue: unknown) {
  const hash = String(publicHashValue || '').trim();
  if (!/^[A-Za-z0-9_-]{25}$/.test(hash)) throw new ServiceError(404, 'Entregable no encontrado');
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.publicHash, hash)).limit(1);
  if (!asset) throw new ServiceError(404, 'Entregable no encontrado');
  if (asset.status !== 'synced' || !asset.storageKey) return { asset: mapAsset(asset), ready: false, downloadUrl: null };
  return { asset: mapAsset(asset), ready: true, downloadUrl: await createPresignedReadUrl(asset.storageKey) };
}

export async function recordMirrorDelivery(publicHashValue: unknown, methodValue: unknown) {
  const payload = await getPublicMirrorAsset(publicHashValue);
  const method = String(methodValue || '').trim();
  if (!['qr', 'share', 'download'].includes(method)) throw new ServiceError(400, 'Metodo de entrega invalido');
  const now = new Date();
  await db.insert(deliveriesTable).values({ assetId: parseEntityId(payload.asset.id), method, status: payload.ready ? 'delivered' : 'pending', deliveredAt: payload.ready ? now : null, createdAt: now });
  return payload;
}

export async function getRuntimeSessionSummary(eventId: unknown, eventModeId: unknown, sessionId: unknown, requester: any) {
  const context = await runtimeContext(eventId, eventModeId, sessionId, requester);
  const runs = await db.select().from(mirrorCaptureRunsTable).where(eq(mirrorCaptureRunsTable.eventModeSessionId, context.session.id));
  return { session: mapSession(context.session), runs: runs.map(mapRun) };
}
