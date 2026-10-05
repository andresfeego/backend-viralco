import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { libraryAssetsTable } from '../db/schema.ts';
import { normalizePrintGuide, validateManual } from '../domain/print-guide.ts';
import { parseEntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { putR2Object, r2PublicUrl, createPresignedReadUrl } from '../r2.ts';
import { isSuperAdmin } from './account-access.service.ts';

// Guide publication is independent of immutable event configuration and print geometry.
export async function savePrintGuide(id: unknown, input: any, file: any, requester: any) {
  if (!isSuperAdmin(requester)) throw new ServiceError(403, 'Se requiere Super Admin');
  const assetId = parseEntityId(id);
  const guide = normalizePrintGuide(input);
  if (file) validateManual(file);
  return db.transaction(async tx => {
    const [asset] = await tx.select().from(libraryAssetsTable).where(eq(libraryAssetsTable.id, assetId)).for('update');
    if (!asset || asset.type !== 'print_profile' || asset.status !== 'active') throw new ServiceError(404, 'Perfil no encontrado');
    const metadata = typeof asset.metadata === 'string' ? JSON.parse(asset.metadata) : asset.metadata || {};
    if (String(input.revision || '') !== String(metadata.printGuide?.revision || '')) throw new ServiceError(409, 'La guia cambio. Vuelve a abrirla antes de guardar');
    const revision = randomUUID();
    let manual = metadata.printGuide?.manual || null;
    if (file) {
      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const key = `${String(asset.storageKey).replace(/\/[^/]+$/, '')}/manuals/${sha256}.pdf`;
      await putR2Object({ key, body: file.buffer, contentType: 'application/pdf' });
      manual = { key, url: r2PublicUrl(key), sha256, sizeBytes: file.buffer.length };
    }
    const published = { ...guide, manual, revision, publishedAt: new Date().toISOString() };
    // A versioned sidecar preserves the document alongside the profile in R2.
    const key = `${String(asset.storageKey).replace(/\/[^/]+$/, '')}/guides/${revision}.json`;
    await putR2Object({ key, body: Buffer.from(JSON.stringify(published)), contentType: 'application/json' });
    await tx.update(libraryAssetsTable).set({ metadata: { ...metadata, printGuide: published }, updatedAt: new Date() }).where(eq(libraryAssetsTable.id, assetId));
    return { ...published, manual: manual ? { ...manual, url: await createPresignedReadUrl(manual.key) } : null };
  });
}
