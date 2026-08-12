import { and, asc, eq, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accountLibraryTable, libraryAssetCategoriesTable, libraryAssetsTable } from '../db/schema.ts';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { assertLibraryKeyScope, assertLibraryUploadInput, createPresignedLibraryUpload } from '../r2.ts';
import { assertAccountAccess, isSuperAdmin } from './account-access.service.ts';

const OWNER_TYPES = new Set(['viralco', 'account']);
const ASSET_TYPES = new Set(['frame', 'overlay', 'intro', 'outro', 'music', 'logo', 'background', 'template', 'branding', 'other']);
const ASSET_STATUSES = new Set(['draft', 'active', 'archived']);

function mapCategory(row: any) {
  return row ? { id: serializeId(row.id), slug: row.slug, name: row.name, description: row.description, isActive: Boolean(row.isActive) } : null;
}

export function mapLibraryAsset(row: any, category?: any) {
  if (!row) return null;
  return {
    id: serializeId(row.id), categoryId: serializeId(row.categoryId), category: category ? mapCategory(category) : undefined,
    ownerType: row.ownerType, ownerAccountId: serializeId(row.ownerAccountId), sourceAssetId: serializeId(row.sourceAssetId),
    name: row.name, type: row.type, storageKey: row.storageKey, fileUrl: row.fileUrl, previewUrl: row.previewUrl,
    mimeType: row.mimeType, sizeBytes: serializeId(row.sizeBytes), tags: row.tags || null, metadata: row.metadata || null,
    status: row.status, createdBy: serializeId(row.createdBy), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function mapAccountLibrary(row: any, asset: any, category?: any) {
  return {
    id: serializeId(row.id), accountId: serializeId(row.accountId), libraryAssetId: serializeId(row.libraryAssetId),
    displayName: row.displayName, notes: row.notes, addedBy: serializeId(row.addedBy),
    asset: mapLibraryAsset(asset, category), createdAt: row.createdAt, updatedAt: row.updatedAt,
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
  return mapLibraryAsset(asset, await findCategory(asset.categoryId));
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
  return rows.map((row) => mapLibraryAsset(row.asset, row.category));
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
  return rows.map((row) => mapAccountLibrary(row.entry, row.asset, row.category));
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
