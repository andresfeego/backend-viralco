import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import heicConvert from 'heic-convert';
import sharp from 'sharp';
import { db } from '../db/index.ts';
import { accountLibraryTable, libraryAssetCategoriesTable, libraryAssetsTable, libraryAssetVariantsTable } from '../db/schema.ts';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { assertLibraryKeyScope, assertLibraryUploadInput, buildLibraryAssetVariantKey, createPresignedLibraryUpload, LIBRARY_PURPOSES, putR2Object, r2PublicUrl } from '../r2.ts';
import { assertAccountAccess, isSuperAdmin } from './account-access.service.ts';

const OWNER_TYPES = new Set(['viralco', 'account']);
const ASSET_TYPES = new Set(['frame', 'overlay', 'intro', 'outro', 'music', 'logo', 'background', 'template', 'branding', 'other']);
const ASSET_STATUSES = new Set(['draft', 'active', 'archived']);
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

function mapVariants(rows: any[] = []) {
  return rows.reduce((acc: any, row: any) => {
    acc[row.variant] = {
      id: serializeId(row.id),
      assetId: serializeId(row.assetId),
      variant: row.variant,
      storageKey: row.storageKey,
      fileUrl: row.fileUrl,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      sizeBytes: serializeId(row.sizeBytes),
      createdAt: row.createdAt,
    };
    return acc;
  }, {});
}

export function mapLibraryAsset(row: any, category?: any, variants?: any[]) {
  if (!row) return null;
  return {
    id: serializeId(row.id), categoryId: serializeId(row.categoryId), category: category ? mapCategory(category) : undefined,
    ownerType: row.ownerType, ownerAccountId: serializeId(row.ownerAccountId), sourceAssetId: serializeId(row.sourceAssetId),
    name: row.name, type: row.type, storageKey: row.storageKey, fileUrl: row.fileUrl, previewUrl: row.previewUrl,
    mimeType: row.mimeType, sizeBytes: serializeId(row.sizeBytes), tags: row.tags || null, metadata: row.metadata || null,
    variants: variants === undefined ? undefined : mapVariants(variants),
    status: row.status, createdBy: serializeId(row.createdBy), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function mapAccountLibrary(row: any, asset: any, category?: any, variants?: any[]) {
  return {
    id: serializeId(row.id), accountId: serializeId(row.accountId), libraryAssetId: serializeId(row.libraryAssetId),
    displayName: row.displayName, notes: row.notes, addedBy: serializeId(row.addedBy),
    asset: mapLibraryAsset(asset, category, variants), createdAt: row.createdAt, updatedAt: row.updatedAt,
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

export async function getLibraryAssetWithVariants(assetId: EntityId | null) {
  if (!assetId) return null;
  const [row] = await db.select({ asset: libraryAssetsTable, category: libraryAssetCategoriesTable })
    .from(libraryAssetsTable)
    .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
    .where(eq(libraryAssetsTable.id, assetId))
    .limit(1);
  if (!row) return null;
  const variantsByAssetId = await findVariants([assetId]);
  return mapLibraryAsset(row.asset, row.category, variantsByAssetId.get(serializeId(assetId)!) || []);
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
  const storageKey = assertLibraryKeyScope({ key: input?.key || input?.storageKey, ownerType: owner.ownerType, accountId: owner.accountId ? serializeId(owner.accountId)! : undefined });
  if (!name) throw new ServiceError(400, 'Nombre de recurso requerido');
  if (!ASSET_TYPES.has(type)) throw new ServiceError(400, 'Tipo de recurso invalido');
  if (!ASSET_STATUSES.has(status)) throw new ServiceError(400, 'Estado de recurso invalido');
  const now = new Date();
  const result = await db.insert(libraryAssetsTable).values({
    categoryId: input?.categoryId ? parseEntityId(input.categoryId, 'ID de categoria') : null,
    ownerType: owner.ownerType,
    ownerAccountId: owner.ownerType === 'account' ? owner.accountId! : null,
    sourceAssetId: input?.sourceAssetId ? parseEntityId(input.sourceAssetId, 'ID de recurso origen') : null,
    name, type, storageKey, fileUrl: input?.fileUrl || input?.url || '', previewUrl: input?.previewUrl || null,
    mimeType: input?.mimeType || input?.contentType || null,
    sizeBytes: input?.sizeBytes ? BigInt(input.sizeBytes) : null,
    tags: Array.isArray(input?.tags) ? input.tags : null,
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : null,
    status, createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
  });
  const assetId = BigInt(result[0]?.insertId || 0);
  const asset = await findAsset(assetId);
  return mapLibraryAsset(asset, await findCategory(asset.categoryId), []);
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
  return rows.map((row) => mapLibraryAsset(row.asset, row.category, variantsByAssetId.get(serializeId(row.asset.id)!) || []));
}

export async function listAccountLibrary(accountIdValue: unknown, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'read', 'library.view');
  const rows = await db.select({ entry: accountLibraryTable, asset: libraryAssetsTable, category: libraryAssetCategoriesTable })
    .from(accountLibraryTable)
    .innerJoin(libraryAssetsTable, eq(accountLibraryTable.libraryAssetId, libraryAssetsTable.id))
    .leftJoin(libraryAssetCategoriesTable, eq(libraryAssetsTable.categoryId, libraryAssetCategoriesTable.id))
    .where(eq(accountLibraryTable.accountId, accountId))
    .orderBy(asc(libraryAssetsTable.type), asc(libraryAssetsTable.name));
  const variantsByAssetId = await findVariants(rows.map((row) => row.asset.id));
  return rows.map((row) => mapAccountLibrary(row.entry, row.asset, row.category, variantsByAssetId.get(serializeId(row.asset.id)!) || []));
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
  return listAccountLibrary(accountId, requester);
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
  const result = await db.insert(libraryAssetsTable).values({
    categoryId: source.categoryId, ownerType: 'account', ownerAccountId: accountId, sourceAssetId: source.id,
    name: String(input?.name || '').trim() || source.name, type: source.type,
    storageKey, fileUrl, previewUrl: input?.previewUrl || source.previewUrl, mimeType: input?.mimeType || source.mimeType,
    sizeBytes: input?.sizeBytes ? BigInt(input.sizeBytes) : source.sizeBytes, tags: source.tags,
    metadata: { ...(source.metadata || {}), ...(input?.metadata || {}), cloned: true }, status: 'active',
    createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
  });
  const clonedId = BigInt(result[0]?.insertId || 0);
  await addAssetToAccountLibrary(accountId, { libraryAssetId: serializeId(clonedId), displayName: input?.displayName || source.name }, requester);
  const cloned = await findAsset(clonedId);
  return mapLibraryAsset(cloned, await findCategory(cloned.categoryId));
}

export async function assertAssetAvailableForEventAccount(assetId: EntityId, accountId: EntityId) {
  const asset = await findAsset(assetId);
  if (!asset) throw new ServiceError(404, 'Recurso no encontrado');
  if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Recurso no pertenece a la cuenta');
  if (!OWNER_TYPES.has(asset.ownerType)) throw new ServiceError(400, 'Owner de recurso invalido');
  return asset;
}
