import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  accountLibraryTable, eventModeConfigsTable, eventModesTable, eventResourcesTable, eventsTable, libraryAssetsTable,
  libraryAssetTemplatesTable, libraryAssetVariantsTable, modesTable,
} from '../db/schema.ts';
import {
  canonicalPhotoLayoutTemplate, PHOTO_LAYOUT_PREVIEW_RENDERER_VERSION, PHOTO_LAYOUT_TEMPLATE_KIND,
  PHOTO_LAYOUT_CANVAS, PHOTO_LAYOUT_EDITABLE_FORMAT, PHOTO_LAYOUT_TEMPLATE_MIME, photoLayoutContentHash, photoLayoutFromMirrorLayout, validatePhotoLayoutTemplate,
} from '../domain/photo-layout-template.ts';
import { defaultMirrorConfig } from '../domain/magic-mirror-config.ts';
import { renderPhotoLayoutTemplateVariants } from '../lib/photo-layout-preview.mjs';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { buildLibraryAssetVariantKey, deleteR2Objects, putR2Object, r2PublicUrl } from '../r2.ts';
import { assertAccountAccess, isSuperAdmin } from './account-access.service.ts';
import { getLibraryAssetWithVariants, normalizeEventTypeScope, replaceAssetEventTypes } from './library.service.ts';
import { saveMirrorConfig } from './magic-mirror.service.ts';

function parseJson(value: any) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function templateRecord(assetId: EntityId) {
  const [row] = await db.select().from(libraryAssetTemplatesTable).where(eq(libraryAssetTemplatesTable.libraryAssetId, assetId)).limit(1);
  return row || null;
}

function mapTemplate(row: any) {
  return row ? {
    libraryAssetId: serializeId(row.libraryAssetId), schemaVersion: row.schemaVersion, kind: row.kind,
    config: parseJson(row.config), contentHash: row.contentHash, previewRendererVersion: row.previewRendererVersion,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  } : null;
}

export async function getPhotoLayoutTemplate(assetIdValue: unknown, requester: any, accountIdValue?: unknown) {
  const assetId = parseEntityId(assetIdValue, 'ID de plantilla');
  const [asset] = await db.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).limit(1);
  if (!asset || asset.type !== 'template' || asset.status !== 'active') throw new ServiceError(404, 'Plantilla no encontrada');
  if (accountIdValue !== undefined) {
    const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
    await assertAccountAccess(accountId, requester, 'read', 'library.view');
    if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Plantilla no disponible para la cuenta');
  } else if (!isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  const record = await templateRecord(assetId);
  if (!record) throw new ServiceError(409, 'El recurso no contiene una plantilla configurable');
  return { asset: await getLibraryAssetWithVariants(assetId), template: mapTemplate(record) };
}

export async function createPhotoLayoutTemplate(input: any, requester: any, owner: { ownerType: 'viralco' | 'account'; accountId?: EntityId }) {
  if (owner.ownerType === 'viralco' && !isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  if (owner.ownerType === 'account') await assertAccountAccess(owner.accountId!, requester, 'write', 'library.manage');
  const name = String(input?.name || '').trim();
  if (!name) throw new ServiceError(400, 'Nombre de plantilla requerido');
  const template = canonicalPhotoLayoutTemplate(input?.template || photoLayoutFromMirrorLayout(input?.layout));
  const validation = validatePhotoLayoutTemplate(template);
  if (!validation.valid) throw new ServiceError(400, JSON.stringify({ code: 'PHOTO_LAYOUT_TEMPLATE_INVALID', errors: validation.errors }));
  if (template.baseFormat !== PHOTO_LAYOUT_EDITABLE_FORMAT || template.output.width !== PHOTO_LAYOUT_CANVAS.width || template.output.height !== PHOTO_LAYOUT_CANVAS.height) {
    throw new ServiceError(400, JSON.stringify({ code: 'PHOTO_LAYOUT_CANVAS_INVALID', message: 'Las nuevas plantillas deben usar el lienzo portrait 2000 x 2960' }));
  }
  const eventTypeScope = await normalizeEventTypeScope(input);
  const contentHash = photoLayoutContentHash(template);
  const now = new Date();
  const scope = owner.ownerType === 'viralco' ? 'viralco' : 'account';
  const prefix = owner.ownerType === 'viralco' ? 'viralco/library' : `accounts/${serializeId(owner.accountId!)}/library`;
  const manifestId = owner.ownerType === 'viralco' ? String(input?.metadata?.manifestId || '').trim() : '';
  const stableManifestId = /^[a-z0-9][a-z0-9-]{2,119}$/.test(manifestId) ? manifestId : '';
  const objectNamespace = stableManifestId || randomUUID();
  const jsonKey = `${prefix}/template/${objectNamespace}/template.json`;
  const uploadedKeys: string[] = [];
  let assetId: EntityId | null = null;
  try {
    const jsonBuffer = Buffer.from(JSON.stringify(template));
    const savedJson = await putR2Object({ key: jsonKey, body: jsonBuffer, contentType: PHOTO_LAYOUT_TEMPLATE_MIME });
    uploadedKeys.push(savedJson.key);
    const result = await db.insert(libraryAssetsTable).values({
      categoryId: null, ownerType: owner.ownerType, ownerAccountId: owner.ownerType === 'account' ? owner.accountId! : null,
      sourceAssetId: null, name, type: 'template', motionType: null,
      appliesToAllEventTypes: eventTypeScope.appliesToAllEventTypes,
      storageKey: jsonKey, fileUrl: r2PublicUrl(jsonKey), previewUrl: null, mimeType: PHOTO_LAYOUT_TEMPLATE_MIME,
      sizeBytes: BigInt(jsonBuffer.byteLength), tags: Array.isArray(input?.tags) ? input.tags : null,
      metadata: { ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}), mirrorCompatible: true, templateKind: PHOTO_LAYOUT_TEMPLATE_KIND, contentHash },
      status: 'active', createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
    });
    assetId = BigInt(result[0]?.insertId || 0);
    const rendered = await renderPhotoLayoutTemplateVariants(template);
    const savedVariants = await Promise.all(rendered.map(async (variant: any) => {
      const key = stableManifestId
        ? `${prefix}/template/${stableManifestId}/${variant.variant}.webp`
        : buildLibraryAssetVariantKey({ scope, accountId: owner.accountId ? serializeId(owner.accountId)! : undefined, purpose: 'template', assetId: serializeId(assetId!)!, variant: variant.variant });
      const saved = await putR2Object({ key, body: variant.buffer, contentType: 'image/webp' });
      uploadedKeys.push(saved.key);
      return { ...variant, ...saved };
    }));
    const thumb = savedVariants.find((variant: any) => variant.variant === 'thumb');
    await db.transaction(async (tx) => {
      await tx.insert(libraryAssetTemplatesTable).values({
        libraryAssetId: assetId!, schemaVersion: 1, kind: PHOTO_LAYOUT_TEMPLATE_KIND, config: template,
        contentHash, previewRendererVersion: PHOTO_LAYOUT_PREVIEW_RENDERER_VERSION, createdAt: now, updatedAt: now,
      });
      await replaceAssetEventTypes(assetId!, eventTypeScope.eventTypeIds, tx);
      if (owner.ownerType === 'account') {
        await tx.insert(accountLibraryTable).values({
          accountId: owner.accountId!, libraryAssetId: assetId!, isFavorite: true,
          favoritedAt: now, favoritedBy: parseEntityId(requester.id), addedBy: parseEntityId(requester.id),
          createdAt: now, updatedAt: now,
        });
      }
      await tx.insert(libraryAssetVariantsTable).values(savedVariants.map((variant: any) => ({
        assetId: assetId!, variant: variant.variant, storageKey: variant.key, fileUrl: variant.fileUrl,
        mimeType: 'image/webp', width: variant.width, height: variant.height, sizeBytes: BigInt(variant.sizeBytes), createdAt: now,
      })));
      await tx.update(libraryAssetsTable).set({ previewUrl: thumb?.fileUrl || null, updatedAt: now }).where(eq(libraryAssetsTable.id, assetId!));
    });
    return getPhotoLayoutTemplate(assetId, requester, owner.ownerType === 'account' ? owner.accountId : undefined);
  } catch (error) {
    if (assetId) await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).catch(() => null);
    await deleteR2Objects(uploadedKeys).catch(() => null);
    throw error;
  }
}

export async function applyPhotoLayoutTemplate(eventIdValue: unknown, eventModeIdValue: unknown, assetIdValue: unknown, input: any, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const eventModeId = parseEntityId(eventModeIdValue, 'ID de modo de evento');
  const assetId = parseEntityId(assetIdValue, 'ID de plantilla');
  const [context] = await db.select({ event: eventsTable, eventMode: eventModesTable, mode: modesTable })
    .from(eventModesTable).innerJoin(eventsTable, eq(eventModesTable.eventId, eventsTable.id)).innerJoin(modesTable, eq(eventModesTable.modeId, modesTable.id))
    .where(and(eq(eventsTable.id, eventId), eq(eventModesTable.id, eventModeId))).limit(1);
  if (!context) throw new ServiceError(404, 'Modo de evento no encontrado');
  await assertAccountAccess(context.event.accountId, requester, 'write', 'events.update');
  if (context.mode.slug !== 'espejo' || !context.eventMode.isActive) throw new ServiceError(409, 'El modo Espejo no esta disponible');
  const [asset] = await db.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).limit(1);
  if (!asset || asset.type !== 'template' || asset.status !== 'active') throw new ServiceError(404, 'Plantilla no encontrada');
  if (asset.ownerType === 'account' && asset.ownerAccountId !== context.event.accountId) throw new ServiceError(403, 'Plantilla no disponible para esta cuenta');
  const record = await templateRecord(assetId);
  if (!record) throw new ServiceError(409, 'El recurso no contiene una plantilla configurable');
  const template = parseJson(record.config);
  const validation = validatePhotoLayoutTemplate(template);
  if (!validation.valid) throw new ServiceError(409, 'La plantilla guardada no es valida');
  const expectedRevision = Number(input?.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ServiceError(400, 'expectedRevision invalida');
  const [current] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, eventModeId)).limit(1);
  const currentConfig = parseJson(current?.config) || defaultMirrorConfig();
  let [resource] = await db.select().from(eventResourcesTable).where(and(
    eq(eventResourcesTable.eventId, eventId), eq(eventResourcesTable.eventModeId, eventModeId),
    eq(eventResourcesTable.libraryAssetId, assetId), eq(eventResourcesTable.purpose, 'template'), eq(eventResourcesTable.isActive, true),
  )).limit(1);
  let createdResourceId: EntityId | null = null;
  if (!resource) {
    const now = new Date();
    const result = await db.insert(eventResourcesTable).values({ eventId, libraryAssetId: assetId, eventModeId, purpose: 'template', placement: 'layout', config: null, orderIndex: 0, isActive: true, createdAt: now, updatedAt: now });
    createdResourceId = BigInt(result[0]?.insertId || 0);
    [resource] = await db.select().from(eventResourcesTable).where(eq(eventResourcesTable.id, createdResourceId)).limit(1);
  }
  const previousTemplateResourceId = currentConfig.resources?.layoutTemplateResourceId;
  const nextConfig = {
    ...currentConfig,
    layout: {
      ...currentConfig.layout,
      format: template.baseFormat, output: template.output, shotCount: template.shotCount,
      order: template.order, slots: template.slots, duplicateStrip: template.duplicateStrip,
    },
    resources: { ...currentConfig.resources, layoutTemplateResourceId: serializeId(resource.id) },
  };
  try {
    const saved = await saveMirrorConfig(eventId, eventModeId, { expectedRevision, schemaVersion: 1, config: nextConfig }, requester);
    if (previousTemplateResourceId && String(previousTemplateResourceId) !== String(resource.id)) {
      await db.update(eventResourcesTable).set({ isActive: false, updatedAt: new Date() }).where(eq(eventResourcesTable.id, parseEntityId(previousTemplateResourceId, 'ID de recurso')));
    }
    return { config: saved, appliedTemplate: { assetId: serializeId(assetId), eventResourceId: serializeId(resource.id), contentHash: record.contentHash } };
  } catch (error) {
    if (createdResourceId) await db.delete(eventResourcesTable).where(eq(eventResourcesTable.id, createdResourceId));
    throw error;
  }
}
