import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import { db } from '../db/index.ts';
import { accountLibraryTable, eventTypesTable, libraryAssetCategoriesTable, libraryAssetEventTypesTable, libraryAssetsTable, libraryAssetVariantsTable } from '../db/schema.ts';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { renderFontPreviewVariants } from '../lib/font-preview.mjs';
import { assertLibraryKeyScope, assertLibraryUploadInput, buildLibraryAssetVariantKey, createPresignedLibraryUpload, createPresignedReadUrl, getR2ObjectBuffer, LIBRARY_PURPOSES, putR2Object, r2PublicUrl } from '../r2.ts';
import { assertAccountAccess, isSuperAdmin } from './account-access.service.ts';

const OWNER_TYPES = new Set(['viralco', 'account']);
const ASSET_TYPES = new Set(['frame', 'sticker', 'overlay', 'intro', 'outro', 'music', 'logo', 'background', 'template', 'branding', 'animation', 'font', 'other']);
const ASSET_STATUSES = new Set(['draft', 'active', 'archived']);
const STICKER_MOTION_TYPES = new Set(['static', 'animated']);
const PROCESSABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']);
const HEIC_TYPES = new Set(['image/heic', 'image/heif']);
const MAX_PROCESSED_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_VARIANTS = [
  { variant: 'thumb', size: 160, quality: 76 },
  { variant: 'card', size: 512, quality: 80 },
  { variant: 'full', size: 1600, quality: 84 },
];

function mapCategory(row: any) {
  return row ? { id: serializeId(row.id), slug: row.slug, name: row.name, description: row.description, isActive: Boolean(row.isActive) } : null;
}

async function mapVariants(rows: any[] = []) {
  const entries = await Promise.all(rows.map(async (row: any) => ({
    key: row.variant,
    value: {
      id: serializeId(row.id),
      assetId: serializeId(row.assetId),
      variant: row.variant,
      storageKey: row.storageKey,
      fileUrl: row.fileUrl,
      signedUrl: await createPresignedReadUrl(row.storageKey),
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      sizeBytes: serializeId(row.sizeBytes),
      createdAt: row.createdAt,
    },
  })));
  return entries.reduce((acc: any, entry: any) => {
    acc[entry.key] = entry.value;
    return acc;
  }, {});
}

export async function mapLibraryAsset(row: any, category?: any, variants?: any[], eventTypes: any[] = []) {
  if (!row) return null;
  return {
    id: serializeId(row.id), categoryId: serializeId(row.categoryId), category: category ? mapCategory(category) : undefined,
    ownerType: row.ownerType, ownerAccountId: serializeId(row.ownerAccountId), sourceAssetId: serializeId(row.sourceAssetId),
    name: row.name, type: row.type, motionType: row.motionType || null, appliesToAllEventTypes: Boolean(row.appliesToAllEventTypes),
    eventTypes: eventTypes.map((eventType) => ({ id: serializeId(eventType.id), slug: eventType.slug, name: eventType.name })),
    storageKey: row.storageKey, fileUrl: row.fileUrl, fileSignedUrl: await createPresignedReadUrl(row.storageKey), previewUrl: row.previewUrl,
    mimeType: row.mimeType, sizeBytes: serializeId(row.sizeBytes), tags: row.tags || null, metadata: row.metadata || null,
    variants: variants === undefined ? undefined : await mapVariants(variants),
    status: row.status, createdBy: serializeId(row.createdBy), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function mapAccountLibrary(row: any, asset: any, category?: any, variants?: any[], accountId?: EntityId, eventTypes: any[] = []) {
  return {
    id: serializeId(row?.id), accountId: serializeId(row?.accountId || accountId), libraryAssetId: serializeId(row?.libraryAssetId || asset.id),
    displayName: row?.displayName || null, notes: row?.notes || null, isFavorite: Boolean(row?.isFavorite), favoritedAt: row?.favoritedAt || null,
    favoritedBy: serializeId(row?.favoritedBy), addedBy: serializeId(row?.addedBy),
    asset: await mapLibraryAsset(asset, category, variants, eventTypes), createdAt: row?.createdAt || null, updatedAt: row?.updatedAt || null,
  };
}

async function findAsset(assetId: EntityId) {
  const [row] = await db.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).limit(1);
  return row || null;
}

async function findCategory(categoryId: EntityId | null) {
  if (!categoryId) return null;
  const [row] = await db.select().from(libraryAssetCategoriesTable).where(eq(libraryAssetCategoriesTable.id, categoryId)).limit(1);
  return row || null;
}

async function findVariants(assetIds: EntityId[]) {
  if (assetIds.length === 0) return new Map<string, any[]>();
  const rows = await db.select().from(libraryAssetVariantsTable).where(inArray(libraryAssetVariantsTable.assetId, assetIds));
  return rows.reduce((acc, row) => {
    const key = serializeId(row.assetId)!;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(row);
    return acc;
  }, new Map<string, any[]>());
}

async function findEventTypes(assetIds: EntityId[]) {
  if (assetIds.length === 0) return new Map<string, any[]>();
  const rows = await db.select({ libraryAssetId: libraryAssetEventTypesTable.libraryAssetId, eventType: eventTypesTable })
    .from(libraryAssetEventTypesTable)
    .innerJoin(eventTypesTable, eq(libraryAssetEventTypesTable.eventTypeId, eventTypesTable.id))
    .where(inArray(libraryAssetEventTypesTable.libraryAssetId, assetIds))
    .orderBy(asc(eventTypesTable.sortOrder), asc(eventTypesTable.name));
  return rows.reduce((acc, row) => {
    const key = serializeId(row.libraryAssetId)!;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(row.eventType);
    return acc;
  }, new Map<string, any[]>());
}

async function normalizeEventTypeScope(input: any) {
  const rawUniversal = input?.appliesToAllEventTypes;
  const appliesToAllEventTypes = rawUniversal === undefined
    ? true
    : rawUniversal === true || String(rawUniversal).trim().toLowerCase() === 'true';
  let eventTypeInput = input?.eventTypeIds;
  if (typeof eventTypeInput === 'string') {
    try { eventTypeInput = JSON.parse(eventTypeInput); }
    catch { eventTypeInput = eventTypeInput.split(','); }
  }
  const rawIds = Array.isArray(eventTypeInput) ? [...new Set(eventTypeInput.map(String).filter(Boolean))] : [];
  if (appliesToAllEventTypes) return { appliesToAllEventTypes: true, eventTypeIds: [] as EntityId[] };
  if (!rawIds.length) throw new ServiceError(400, 'Selecciona al menos un tipo de evento');
  const eventTypeIds = rawIds.map((id) => parseEntityId(id, 'ID de tipo de evento'));
  const rows = await db.select({ id: eventTypesTable.id }).from(eventTypesTable)
    .where(and(inArray(eventTypesTable.id, eventTypeIds), eq(eventTypesTable.isActive, true)));
  if (rows.length !== eventTypeIds.length) throw new ServiceError(400, 'Tipo de evento invalido');
  return { appliesToAllEventTypes: false, eventTypeIds };
}

function normalizeMotionType(type: string, mimeType: string, inputMotionType?: unknown) {
  const motionType = String(inputMotionType || '').trim().toLowerCase();
  if (type !== 'sticker') {
    if (motionType) throw new ServiceError(400, 'motionType solo aplica a stickers');
    return null;
  }
  const inferred = mimeType.toLowerCase() === 'image/gif' ? 'animated' : 'static';
  const normalized = motionType || inferred;
  if (!STICKER_MOTION_TYPES.has(normalized)) throw new ServiceError(400, 'Movimiento de sticker invalido');
  if (normalized === 'animated' && mimeType.toLowerCase() !== 'image/gif') throw new ServiceError(400, 'El sticker con movimiento debe ser GIF');
  if (normalized === 'static' && mimeType && mimeType.toLowerCase() !== 'image/png') throw new ServiceError(400, 'El sticker sin movimiento debe ser PNG');
  return normalized;
}

async function replaceAssetEventTypes(assetId: EntityId, eventTypeIds: EntityId[], tx: any = db) {
  await tx.delete(libraryAssetEventTypesTable).where(eq(libraryAssetEventTypesTable.libraryAssetId, assetId));
  if (!eventTypeIds.length) return;
  await tx.insert(libraryAssetEventTypesTable).values(eventTypeIds.map((eventTypeId) => ({
    libraryAssetId: assetId,
    eventTypeId,
    createdAt: new Date(),
  })));
}

export async function getLibraryAssetWithVariants(assetId: EntityId | null) {
  if (!assetId) return null;
  const [row] = await db.select({ asset: libraryAssetsTable, category: libraryAssetCategoriesTable })
    .from(libraryAssetsTable)
    .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
    .where(eq(libraryAssetsTable.id, assetId))
    .limit(1);
  if (!row) return null;
  const variantsByAssetId = await findVariants([assetId]);
  const eventTypesByAssetId = await findEventTypes([assetId]);
  return mapLibraryAsset(row.asset, row.category, variantsByAssetId.get(serializeId(assetId)!) || [], eventTypesByAssetId.get(serializeId(assetId)!) || []);
}

export async function prepareGlobalLibraryUpload(input: any, requester: any) {
  if (!isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  const upload = assertLibraryUploadInput(input);
  return createPresignedLibraryUpload({ scope: 'viralco', purpose: upload.purpose, contentType: upload.contentType, fileName: upload.fileName });
}

export async function prepareAccountLibraryUpload(accountIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'write', 'library.manage');
  const upload = assertLibraryUploadInput(input);
  return createPresignedLibraryUpload({ scope: 'account', accountId: serializeId(accountId)!, purpose: upload.purpose, contentType: upload.contentType, fileName: upload.fileName });
}

export async function createLibraryAsset(input: any, requester: any, owner: { ownerType: 'viralco' | 'account'; accountId?: EntityId }) {
  if (owner.ownerType === 'viralco' && !isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  if (owner.ownerType === 'account') await assertAccountAccess(owner.accountId!, requester, 'write', 'library.manage');
  const name = String(input?.name || '').trim();
  const type = String(input?.type || input?.purpose || '').trim();
  const status = String(input?.status || 'active').trim();
  const mimeType = String(input?.mimeType || input?.contentType || '').trim().toLowerCase();
  const storageKey = assertLibraryKeyScope({ key: input?.key || input?.storageKey, ownerType: owner.ownerType, accountId: owner.accountId ? serializeId(owner.accountId)! : undefined });
  if (!name) throw new ServiceError(400, 'Nombre de recurso requerido');
  if (!ASSET_TYPES.has(type)) throw new ServiceError(400, 'Tipo de recurso invalido');
  if (type === 'template') throw new ServiceError(400, 'Las plantillas de diseno aun no estan disponibles');
  if (!ASSET_STATUSES.has(status)) throw new ServiceError(400, 'Estado de recurso invalido');
  const motionType = normalizeMotionType(type, mimeType, input?.motionType);
  const eventTypeScope = await normalizeEventTypeScope(input);
  const fontPreview = type === 'font' ? await renderFontPreviewVariants(await getR2ObjectBuffer(storageKey)) : null;
  const metadata = {
    ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    ...(fontPreview?.metadata || {}),
  };
  const now = new Date();
  const assetId = await db.transaction(async (tx) => {
    const result = await tx.insert(libraryAssetsTable).values({
      categoryId: input?.categoryId ? parseEntityId(input.categoryId, 'ID de categoria') : null,
      ownerType: owner.ownerType,
      ownerAccountId: owner.ownerType === 'account' ? owner.accountId! : null,
      sourceAssetId: input?.sourceAssetId ? parseEntityId(input.sourceAssetId, 'ID de recurso origen') : null,
      name, type, motionType, appliesToAllEventTypes: eventTypeScope.appliesToAllEventTypes,
      storageKey, fileUrl: input?.fileUrl || input?.url || '', previewUrl: input?.previewUrl || null,
      mimeType: mimeType || null,
      sizeBytes: input?.sizeBytes ? BigInt(input.sizeBytes) : null,
      tags: Array.isArray(input?.tags) ? input.tags : null,
      metadata: Object.keys(metadata).length ? metadata : null,
      status, createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
    });
    const id = BigInt(result[0]?.insertId || 0);
    await replaceAssetEventTypes(id, eventTypeScope.eventTypeIds, tx);
    return id;
  });
  if (fontPreview) {
    try {
      const savedVariants = await Promise.all(fontPreview.variants.map(async (variant: any) => {
        const key = buildLibraryAssetVariantKey({
          scope: owner.ownerType === 'viralco' ? 'viralco' : 'account',
          accountId: owner.accountId ? serializeId(owner.accountId)! : undefined,
          purpose: 'font',
          assetId: serializeId(assetId)!,
          variant: variant.variant,
        });
        const saved = await putR2Object({ key, body: variant.buffer, contentType: 'image/webp' });
        return { ...variant, ...saved };
      }));
      await db.insert(libraryAssetVariantsTable).values(savedVariants.map((variant) => ({
        assetId,
        variant: variant.variant,
        storageKey: variant.key,
        fileUrl: variant.fileUrl,
        mimeType: 'image/webp',
        width: variant.width,
        height: variant.height,
        sizeBytes: BigInt(variant.sizeBytes),
        createdAt: now,
      })));
      const thumb = savedVariants.find((variant) => variant.variant === 'thumb');
      if (thumb) await db.update(libraryAssetsTable).set({ previewUrl: thumb.fileUrl, updatedAt: new Date() }).where(eq(libraryAssetsTable.id, assetId));
    } catch (error) {
      await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId));
      throw new ServiceError(400, error instanceof Error ? error.message : 'No se pudo procesar la fuente');
    }
  }
  const asset = await findAsset(assetId);
  const eventTypesByAssetId = await findEventTypes([assetId]);
  return mapLibraryAsset(asset, await findCategory(asset.categoryId), [], eventTypesByAssetId.get(serializeId(assetId)!) || []);
}

function fallbackMimeFromName(fileName: string, mimeType?: string) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (PROCESSABLE_IMAGE_TYPES.has(normalizedMime)) return normalizedMime;
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  if (ext === 'avif') return 'image/avif';
  return '';
}

async function normalizeImageInput(buffer: Buffer, mimeType: string) {
  if (!HEIC_TYPES.has(mimeType)) return buffer;
  const converted = await heicConvert({ buffer, format: 'PNG', quality: 1 });
  return Buffer.from(converted as ArrayBuffer);
}

async function renderImageVariant(inputBuffer: Buffer, size: number, quality: number) {
  const rendered = await sharp(inputBuffer, { animated: false })
    .rotate()
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: rendered.data, width: rendered.info.width, height: rendered.info.height, sizeBytes: rendered.info.size };
}

async function assertProcessedImageInput(input: any, file: any) {
  const purpose = String(input?.purpose || '').trim();
  const name = String(input?.name || file?.originalname || '').trim() || 'imagen';
  if (!LIBRARY_PURPOSES.has(purpose)) throw new ServiceError(400, 'Proposito de upload invalido');
  if (!ASSET_TYPES.has(purpose)) throw new ServiceError(400, 'Tipo de recurso invalido');
  if (purpose === 'template') throw new ServiceError(400, 'Las plantillas de diseno aun no estan disponibles');
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw new ServiceError(400, 'Archivo requerido');
  if (file.size <= 0 || file.size > MAX_PROCESSED_IMAGE_BYTES) throw new ServiceError(400, 'Tamano de archivo invalido');

  const detected = await fileTypeFromBuffer(file.buffer).catch(() => null);
  const mimeType = detected?.mime || fallbackMimeFromName(file.originalname || '', file.mimetype);
  if (!PROCESSABLE_IMAGE_TYPES.has(mimeType)) throw new ServiceError(400, 'Tipo de imagen no permitido');
  return { purpose, name, originalMimeType: mimeType };
}

export async function createProcessedLibraryImageAsset(input: any, file: any, requester: any, owner: { ownerType: 'viralco' | 'account'; accountId?: EntityId }) {
  if (owner.ownerType === 'viralco' && !isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  if (owner.ownerType === 'account') await assertAccountAccess(owner.accountId!, requester, 'write', 'library.manage');
  const upload = await assertProcessedImageInput(input, file);
  const eventTypeScope = await normalizeEventTypeScope(input);
  const motionType = normalizeMotionType(upload.purpose, upload.originalMimeType, input?.motionType);
  const scope = owner.ownerType === 'viralco' ? 'viralco' : 'account';
  const now = new Date();
  const tempKey = `${scope === 'viralco' ? 'viralco' : `accounts/${serializeId(owner.accountId!)}`}/library/${upload.purpose}/pending/${randomUUID()}.webp`;
  const result = await db.insert(libraryAssetsTable).values({
    categoryId: input?.categoryId ? parseEntityId(input.categoryId, 'ID de categoria') : null,
    ownerType: owner.ownerType,
    ownerAccountId: owner.ownerType === 'account' ? owner.accountId! : null,
    sourceAssetId: input?.sourceAssetId ? parseEntityId(input.sourceAssetId, 'ID de recurso origen') : null,
    name: upload.name,
    type: upload.purpose,
    motionType,
    appliesToAllEventTypes: eventTypeScope.appliesToAllEventTypes,
    storageKey: tempKey,
    fileUrl: r2PublicUrl(tempKey),
    previewUrl: null,
    mimeType: 'image/webp',
    sizeBytes: null,
    tags: Array.isArray(input?.tags) ? input.tags : null,
    metadata: { ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}), processed: true, originalMimeType: upload.originalMimeType },
    status: 'active',
    createdBy: parseEntityId(requester.id),
    createdAt: now,
    updatedAt: now,
  });
  const assetId = BigInt(result[0]?.insertId || 0);

  try {
    await replaceAssetEventTypes(assetId, eventTypeScope.eventTypeIds);
    const normalizedInput = await normalizeImageInput(file.buffer, upload.originalMimeType);
    const renderedVariants = await Promise.all(IMAGE_VARIANTS.map(async (variantConfig) => {
      const rendered = await renderImageVariant(normalizedInput, variantConfig.size, variantConfig.quality);
      const key = buildLibraryAssetVariantKey({
        scope,
        accountId: owner.accountId ? serializeId(owner.accountId)! : undefined,
        purpose: upload.purpose,
        assetId: serializeId(assetId)!,
        variant: variantConfig.variant,
      });
      const saved = await putR2Object({ key, body: rendered.buffer, contentType: 'image/webp' });
      return { ...variantConfig, ...rendered, key: saved.key, fileUrl: saved.fileUrl };
    }));
    const full = renderedVariants.find((variant) => variant.variant === 'full')!;
    if (upload.purpose === 'logo' && full.width !== full.height) {
      throw new ServiceError(400, 'El logo debe tener corte cuadrado');
    }
    await db.insert(libraryAssetVariantsTable).values(renderedVariants.map((variant) => ({
      assetId,
      variant: variant.variant,
      storageKey: variant.key,
      fileUrl: variant.fileUrl,
      mimeType: 'image/webp',
      width: variant.width,
      height: variant.height,
      sizeBytes: BigInt(variant.sizeBytes),
      createdAt: now,
    })));
    const thumb = renderedVariants.find((variant) => variant.variant === 'thumb')!;
    await db.update(libraryAssetsTable).set({
      storageKey: full.key,
      fileUrl: full.fileUrl,
      previewUrl: thumb.fileUrl,
      mimeType: 'image/webp',
      sizeBytes: BigInt(full.sizeBytes),
      updatedAt: new Date(),
    }).where(eq(libraryAssetsTable.id, assetId));
  } catch (error) {
    await db.delete(libraryAssetEventTypesTable).where(eq(libraryAssetEventTypesTable.libraryAssetId, assetId));
    await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId));
    throw error instanceof ServiceError ? error : new ServiceError(400, error instanceof Error ? error.message : 'No se pudo procesar imagen');
  }

  return getLibraryAssetWithVariants(assetId);
}

export async function listLibraryAssets(query: any, requester: any) {
  const accountId = query?.accountId ? parseEntityId(query.accountId, 'ID de cuenta') : null;
  if (accountId) await assertAccountAccess(accountId, requester, 'read', 'library.view');
  else if (!isSuperAdmin(requester)) throw new ServiceError(403, 'accountId requerido');

  const rows = await db.select({ asset: libraryAssetsTable, category: libraryAssetCategoriesTable })
    .from(libraryAssetsTable)
    .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
    .where(accountId ? or(eq(libraryAssetsTable.ownerType, 'viralco'), and(eq(libraryAssetsTable.ownerType, 'account'), eq(libraryAssetsTable.ownerAccountId, accountId))) : undefined as any)
    .orderBy(asc(libraryAssetsTable.ownerType), asc(libraryAssetsTable.type), asc(libraryAssetsTable.name));
  const variantsByAssetId = await findVariants(rows.map((row) => row.asset.id));
  const eventTypesByAssetId = await findEventTypes(rows.map((row) => row.asset.id));
  return Promise.all(rows.map((row) => mapLibraryAsset(
    row.asset,
    row.category,
    variantsByAssetId.get(serializeId(row.asset.id)!) || [],
    eventTypesByAssetId.get(serializeId(row.asset.id)!) || [],
  )));
}

export async function listAccountLibrary(accountIdValue: unknown, requester: any, query: any = {}) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'read', 'library.view');
  const page = Math.max(1, Math.floor(Number(query?.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query?.pageSize) || 30)));
  const scope = String(query?.scope || 'linked').trim().toLowerCase();
  if (!['linked', 'global', 'available'].includes(scope)) throw new ServiceError(400, 'Scope de biblioteca invalido');

  if (scope !== 'linked') {
    const conditions: any[] = [eq(libraryAssetsTable.status, 'active')];
    conditions.push(scope === 'global'
      ? eq(libraryAssetsTable.ownerType, 'viralco')
      : or(
        eq(libraryAssetsTable.ownerType, 'viralco'),
        and(eq(libraryAssetsTable.ownerType, 'account'), eq(libraryAssetsTable.ownerAccountId, accountId)),
      )!);
    if (String(query?.favorite || '') === 'true') conditions.push(eq(accountLibraryTable.isFavorite, true));
    if (String(query?.favorite || '') === 'false') conditions.push(or(isNull(accountLibraryTable.id), eq(accountLibraryTable.isFavorite, false))!);
    const type = String(query?.type || '').trim();
    const motion = String(query?.motion || '').trim().toLowerCase();
    const eventType = String(query?.eventType || '').trim().toLowerCase();
    const category = String(query?.category || '').trim();
    const search = String(query?.q || '').trim();
    if (type) conditions.push(eq(libraryAssetsTable.type, type));
    if (motion) {
      if (!STICKER_MOTION_TYPES.has(motion)) throw new ServiceError(400, 'Movimiento de sticker invalido');
      conditions.push(eq(libraryAssetsTable.type, 'sticker'), eq(libraryAssetsTable.motionType, motion));
    }
    if (eventType) {
      conditions.push(sql`exists (
        select 1 from ${libraryAssetEventTypesTable}
        inner join ${eventTypesTable} on ${eventTypesTable.id} = ${libraryAssetEventTypesTable.eventTypeId}
        where ${libraryAssetEventTypesTable.libraryAssetId} = ${libraryAssetsTable.id}
          and ${eventTypesTable.slug} = ${eventType}
          and ${eventTypesTable.isActive} = true
      )`);
    }
    if (category) conditions.push(eq(libraryAssetCategoriesTable.slug, category));
    if (search) conditions.push(or(like(libraryAssetsTable.name, `%${search}%`), like(accountLibraryTable.displayName, `%${search}%`))!);
    const joinAccountEntry = and(
      eq(accountLibraryTable.libraryAssetId, libraryAssetsTable.id),
      eq(accountLibraryTable.accountId, accountId),
    );
    const where = and(...conditions);
    const baseQuery = db.select({ entry: accountLibraryTable, asset: libraryAssetsTable, category: libraryAssetCategoriesTable })
      .from(libraryAssetsTable)
      .leftJoin(accountLibraryTable, joinAccountEntry)
      .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
      .where(where);
    const rows = String(query?.favorite || '') === 'true'
      ? await baseQuery.orderBy(desc(accountLibraryTable.favoritedAt), desc(libraryAssetsTable.id)).limit(pageSize).offset((page - 1) * pageSize)
      : await baseQuery.orderBy(desc(libraryAssetsTable.createdAt), desc(libraryAssetsTable.id)).limit(pageSize).offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)` })
      .from(libraryAssetsTable)
      .leftJoin(accountLibraryTable, joinAccountEntry)
      .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
      .where(where);
    const variantsByAssetId = await findVariants(rows.map((row) => row.asset.id));
    const eventTypesByAssetId = await findEventTypes(rows.map((row) => row.asset.id));
    const library = await Promise.all(rows.map((row) => mapAccountLibrary(
      row.entry,
      row.asset,
      row.category,
      variantsByAssetId.get(serializeId(row.asset.id)!) || [],
      accountId,
      eventTypesByAssetId.get(serializeId(row.asset.id)!) || [],
    )));
    const total = Number(countRow?.count || 0);
    return { library, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  const conditions: any[] = [eq(accountLibraryTable.accountId, accountId)];
  if (String(query?.favorite || '') === 'true') conditions.push(eq(accountLibraryTable.isFavorite, true));
  if (String(query?.favorite || '') === 'false') conditions.push(eq(accountLibraryTable.isFavorite, false));
  const type = String(query?.type || '').trim();
  const motion = String(query?.motion || '').trim().toLowerCase();
  const eventType = String(query?.eventType || '').trim().toLowerCase();
  const category = String(query?.category || '').trim();
  const search = String(query?.q || '').trim();
  if (type) conditions.push(eq(libraryAssetsTable.type, type));
  if (motion) {
    if (!STICKER_MOTION_TYPES.has(motion)) throw new ServiceError(400, 'Movimiento de sticker invalido');
    conditions.push(eq(libraryAssetsTable.type, 'sticker'), eq(libraryAssetsTable.motionType, motion));
  }
  if (eventType) {
    conditions.push(sql`exists (
      select 1 from ${libraryAssetEventTypesTable}
      inner join ${eventTypesTable} on ${eventTypesTable.id} = ${libraryAssetEventTypesTable.eventTypeId}
      where ${libraryAssetEventTypesTable.libraryAssetId} = ${libraryAssetsTable.id}
        and ${eventTypesTable.slug} = ${eventType}
        and ${eventTypesTable.isActive} = true
    )`);
  }
  if (category) conditions.push(eq(libraryAssetCategoriesTable.slug, category));
  if (search) conditions.push(or(like(libraryAssetsTable.name, `%${search}%`), like(accountLibraryTable.displayName, `%${search}%`))!);
  const where = and(...conditions);
  const rows = await db.select({ entry: accountLibraryTable, asset: libraryAssetsTable, category: libraryAssetCategoriesTable })
    .from(accountLibraryTable)
    .innerJoin(libraryAssetsTable, eq(accountLibraryTable.libraryAssetId, libraryAssetsTable.id))
    .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
    .where(where)
    .orderBy(desc(accountLibraryTable.isFavorite), asc(libraryAssetsTable.type), asc(libraryAssetsTable.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [countRow] = await db.select({ count: sql<number>`count(*)` })
    .from(accountLibraryTable)
    .innerJoin(libraryAssetsTable, eq(accountLibraryTable.libraryAssetId, libraryAssetsTable.id))
    .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
    .where(where);
  const variantsByAssetId = await findVariants(rows.map((row) => row.asset.id));
  const eventTypesByAssetId = await findEventTypes(rows.map((row) => row.asset.id));
  const library = await Promise.all(rows.map((row) => mapAccountLibrary(
    row.entry,
    row.asset,
    row.category,
    variantsByAssetId.get(serializeId(row.asset.id)!) || [],
    undefined,
    eventTypesByAssetId.get(serializeId(row.asset.id)!) || [],
  )));
  const total = Number(countRow?.count || 0);
  return { library, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}

export async function addAssetToAccountLibrary(accountIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'write', 'library.manage');
  const libraryAssetId = parseEntityId(input?.libraryAssetId, 'ID de recurso');
  const asset = await findAsset(libraryAssetId);
  if (!asset) throw new ServiceError(404, 'Recurso no encontrado');
  if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Recurso no pertenece a la cuenta');
  const now = new Date();
  await db.insert(accountLibraryTable).values({
    accountId, libraryAssetId, displayName: String(input?.displayName || '').trim() || null,
    notes: String(input?.notes || '').trim() || null, addedBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
  }).onDuplicateKeyUpdate({ set: { updatedAt: now } });
  return (await listAccountLibrary(accountId, requester)).library;
}

export async function setAccountLibraryFavorite(accountIdValue: unknown, assetIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  const libraryAssetId = parseEntityId(assetIdValue, 'ID de recurso');
  await assertAccountAccess(accountId, requester, 'write', 'library.manage');
  const asset = await findAsset(libraryAssetId);
  if (!asset || asset.status !== 'active') throw new ServiceError(404, 'Recurso activo no encontrado');
  if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Recurso no pertenece a la cuenta');
  if (!OWNER_TYPES.has(asset.ownerType)) throw new ServiceError(400, 'Owner de recurso invalido');
  const isFavorite = Boolean(input?.isFavorite);
  const now = new Date();
  const favoriteState = { isFavorite, favoritedAt: isFavorite ? now : null, favoritedBy: isFavorite ? parseEntityId(requester.id) : null, updatedAt: now };
  let [entry] = await db.select().from(accountLibraryTable).where(and(eq(accountLibraryTable.accountId, accountId), eq(accountLibraryTable.libraryAssetId, libraryAssetId))).limit(1);
  if (!entry && isFavorite) {
    await db.insert(accountLibraryTable).values({
      accountId,
      libraryAssetId,
      addedBy: parseEntityId(requester.id),
      ...favoriteState,
      createdAt: now,
    }).onDuplicateKeyUpdate({ set: favoriteState });
    [entry] = await db.select().from(accountLibraryTable).where(and(eq(accountLibraryTable.accountId, accountId), eq(accountLibraryTable.libraryAssetId, libraryAssetId))).limit(1);
  } else if (entry) {
    await db.update(accountLibraryTable).set(favoriteState).where(eq(accountLibraryTable.id, entry.id));
    entry = { ...entry, ...favoriteState };
  }
  const category = await findCategory(asset.categoryId);
  const variantsByAssetId = await findVariants([libraryAssetId]);
  const eventTypesByAssetId = await findEventTypes([libraryAssetId]);
  return mapAccountLibrary(entry, asset, category, variantsByAssetId.get(serializeId(libraryAssetId)!) || [], accountId, eventTypesByAssetId.get(serializeId(libraryAssetId)!) || []);
}

export async function cloneAssetForAccount(accountIdValue: unknown, assetIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'write', 'library.manage');
  const sourceId = parseEntityId(assetIdValue, 'ID de recurso');
  const source = await findAsset(sourceId);
  if (!source) throw new ServiceError(404, 'Recurso origen no encontrado');
  if (source.ownerType !== 'viralco') throw new ServiceError(400, 'Solo se clonan recursos globales');
  const storageKey = assertLibraryKeyScope({ key: input?.key || input?.storageKey, ownerType: 'account', accountId: serializeId(accountId)! });
  const fileUrl = String(input?.fileUrl || input?.url || '').trim();
  if (!fileUrl) throw new ServiceError(400, 'fileUrl requerido para clonar recurso personalizado');
  const now = new Date();
  const sourceEventTypes = await db.select({ eventTypeId: libraryAssetEventTypesTable.eventTypeId })
    .from(libraryAssetEventTypesTable)
    .where(eq(libraryAssetEventTypesTable.libraryAssetId, source.id));
  const clonedId = await db.transaction(async (tx) => {
    const result = await tx.insert(libraryAssetsTable).values({
      categoryId: source.categoryId, ownerType: 'account', ownerAccountId: accountId, sourceAssetId: source.id,
      name: String(input?.name || '').trim() || source.name, type: source.type, motionType: source.motionType,
      appliesToAllEventTypes: source.appliesToAllEventTypes,
      storageKey, fileUrl, previewUrl: input?.previewUrl || source.previewUrl, mimeType: input?.mimeType || source.mimeType,
      sizeBytes: input?.sizeBytes ? BigInt(input.sizeBytes) : source.sizeBytes, tags: source.tags,
      metadata: { ...(source.metadata || {}), ...(input?.metadata || {}), cloned: true }, status: 'active',
      createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
    });
    const id = BigInt(result[0]?.insertId || 0);
    await replaceAssetEventTypes(id, sourceEventTypes.map((row) => row.eventTypeId), tx);
    return id;
  });
  await addAssetToAccountLibrary(accountId, { libraryAssetId: serializeId(clonedId), displayName: input?.displayName || source.name }, requester);
  const cloned = await findAsset(clonedId);
  const eventTypesByAssetId = await findEventTypes([clonedId]);
  return mapLibraryAsset(cloned, await findCategory(cloned.categoryId), undefined, eventTypesByAssetId.get(serializeId(clonedId)!) || []);
}

export async function assertAssetAvailableForEventAccount(assetId: EntityId, accountId: EntityId) {
  const asset = await findAsset(assetId);
  if (!asset) throw new ServiceError(404, 'Recurso no encontrado');
  if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Recurso no pertenece a la cuenta');
  if (!OWNER_TYPES.has(asset.ownerType)) throw new ServiceError(400, 'Owner de recurso invalido');
  return asset;
}
