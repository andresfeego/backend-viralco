import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accountLibraryTable, libraryAssetsTable, libraryAssetTemplatesTable, libraryAssetVariantsTable } from '../db/schema.ts';
import { canonicalPrintProfile, PRINT_PROFILE_KIND, PRINT_PROFILE_MIME, printProfileContentHash, validatePrintProfile } from '../domain/print-profile.ts';
import { renderPrintProfileVariants } from '../lib/print-profile-preview.mjs';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { buildLibraryAssetVariantKey, deleteR2Objects, putR2Object, r2PublicUrl } from '../r2.ts';
import { isSuperAdmin } from './account-access.service.ts';
import { assertLibraryAccountAccess } from './event-access.service.ts';
import { getLibraryAssetWithVariants, normalizeEventTypeScope, replaceAssetEventTypes } from './library.service.ts';

function parseJson(value: any) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function profileRecord(assetId: EntityId) {
  const [row] = await db.select().from(libraryAssetTemplatesTable).where(eq(libraryAssetTemplatesTable.libraryAssetId, assetId)).limit(1);
  return row || null;
}

function mapProfile(row: any) {
  return row ? {
    libraryAssetId: serializeId(row.libraryAssetId), schemaVersion: row.schemaVersion, kind: row.kind,
    config: parseJson(row.config), contentHash: row.contentHash, previewRendererVersion: row.previewRendererVersion,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  } : null;
}

export async function getPrintProfile(assetIdValue: unknown, requester: any, accountIdValue?: unknown) {
  const assetId = parseEntityId(assetIdValue, 'ID de perfil de impresion');
  const [asset] = await db.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).limit(1);
  if (!asset || asset.type !== 'print_profile' || asset.status !== 'active') throw new ServiceError(404, 'Perfil de impresion no encontrado');
  if (accountIdValue !== undefined) {
    const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
    await assertLibraryAccountAccess(accountId, requester, 'read', 'library.view');
    if (asset.ownerType === 'account' && asset.ownerAccountId !== accountId) throw new ServiceError(403, 'Perfil no disponible para la cuenta');
  } else if (!isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  const record = await profileRecord(assetId);
  if (!record || record.kind !== PRINT_PROFILE_KIND) throw new ServiceError(409, 'El recurso no contiene un perfil de impresion');
  return { asset: await getLibraryAssetWithVariants(assetId), profile: mapProfile(record) };
}

export async function createPrintProfile(input: any, requester: any, owner: { ownerType: 'viralco' | 'account'; accountId?: EntityId }) {
  if (owner.ownerType === 'viralco' && !isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  if (owner.ownerType === 'account') await assertLibraryAccountAccess(owner.accountId!, requester, 'write', 'library.manage');
  const name = String(input?.name || '').trim();
  if (!name) throw new ServiceError(400, 'Nombre de perfil requerido');
  const profile = canonicalPrintProfile(input?.profile);
  const validation = validatePrintProfile(profile);
  if (!validation.valid) throw new ServiceError(400, JSON.stringify({ code: 'PRINT_PROFILE_INVALID', errors: validation.errors }));
  const eventTypeScope = await normalizeEventTypeScope(input);
  const contentHash = printProfileContentHash(profile);
  const now = new Date();
  const scope = owner.ownerType === 'viralco' ? 'viralco' : 'account';
  const prefix = owner.ownerType === 'viralco' ? 'viralco/library' : `accounts/${serializeId(owner.accountId!)}/library`;
  const manifestId = owner.ownerType === 'viralco' ? String(input?.metadata?.manifestId || '').trim() : '';
  const stableManifestId = /^[a-z0-9][a-z0-9-]{2,119}$/.test(manifestId) ? manifestId : '';
  const namespace = stableManifestId || randomUUID();
  const jsonKey = `${prefix}/print_profile/${namespace}/profile.json`;
  const uploadedKeys: string[] = [];
  let assetId: EntityId | null = null;
  try {
    const jsonBuffer = Buffer.from(JSON.stringify(profile));
    const savedJson = await putR2Object({ key: jsonKey, body: jsonBuffer, contentType: PRINT_PROFILE_MIME });
    uploadedKeys.push(savedJson.key);
    const result = await db.insert(libraryAssetsTable).values({
      categoryId: null, ownerType: owner.ownerType, ownerAccountId: owner.ownerType === 'account' ? owner.accountId! : null,
      sourceAssetId: null, name, type: 'print_profile', motionType: null,
      appliesToAllEventTypes: eventTypeScope.appliesToAllEventTypes,
      storageKey: jsonKey, fileUrl: r2PublicUrl(jsonKey), previewUrl: null, mimeType: PRINT_PROFILE_MIME,
      sizeBytes: BigInt(jsonBuffer.byteLength), tags: Array.isArray(input?.tags) ? input.tags : null,
      metadata: { ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}), printGuide: null, mirrorCompatible: true, templateKind: PRINT_PROFILE_KIND, contentHash, printProfile: profile },
      status: 'active', createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
    });
    assetId = BigInt(result[0]?.insertId || 0);
    const rendered = await renderPrintProfileVariants(profile);
    const savedVariants = await Promise.all(rendered.map(async (variant: any) => {
      const key = stableManifestId
        ? `${prefix}/print_profile/${stableManifestId}/${variant.variant}.webp`
        : buildLibraryAssetVariantKey({ scope, accountId: owner.accountId ? serializeId(owner.accountId)! : undefined, purpose: 'print_profile', assetId: serializeId(assetId!)!, variant: variant.variant });
      const saved = await putR2Object({ key, body: variant.buffer, contentType: 'image/webp' });
      uploadedKeys.push(saved.key);
      return { ...variant, ...saved };
    }));
    const thumb = savedVariants.find((variant: any) => variant.variant === 'thumb');
    await db.transaction(async (tx) => {
      await tx.insert(libraryAssetTemplatesTable).values({ libraryAssetId: assetId!, schemaVersion: 1, kind: PRINT_PROFILE_KIND, config: profile, contentHash, previewRendererVersion: 1, createdAt: now, updatedAt: now });
      await replaceAssetEventTypes(assetId!, eventTypeScope.eventTypeIds, tx);
      if (owner.ownerType === 'account') await tx.insert(accountLibraryTable).values({
        accountId: owner.accountId!, libraryAssetId: assetId!, isFavorite: true, favoritedAt: now,
        favoritedBy: parseEntityId(requester.id), addedBy: parseEntityId(requester.id), createdAt: now, updatedAt: now,
      });
      await tx.insert(libraryAssetVariantsTable).values(savedVariants.map((variant: any) => ({ assetId: assetId!, variant: variant.variant, storageKey: variant.key, fileUrl: variant.fileUrl, mimeType: 'image/webp', width: variant.width, height: variant.height, sizeBytes: BigInt(variant.sizeBytes), createdAt: now })));
      await tx.update(libraryAssetsTable).set({ previewUrl: thumb?.fileUrl || null, updatedAt: now }).where(eq(libraryAssetsTable.id, assetId!));
    });
    return getPrintProfile(assetId, requester, owner.ownerType === 'account' ? owner.accountId : undefined);
  } catch (error) {
    if (assetId) await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).catch(() => null);
    await deleteR2Objects(uploadedKeys).catch(() => null);
    throw error;
  }
}
