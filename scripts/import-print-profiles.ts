import 'dotenv/config';
import knexFactory from 'knex';
import knexConfig from '../knexfile.cjs';
import definitions from '../resources/print-profiles.json';
import { createPrintProfile } from '../src/services/print-profile.service.ts';
import { PRINT_PROFILE_MIME, printProfileContentHash } from '../src/domain/print-profile.ts';
import { renderPrintProfileVariants } from '../src/lib/print-profile-preview.mjs';
import { putR2Object, r2ObjectExists, r2PublicUrl } from '../src/r2.ts';

const db = knexFactory((knexConfig as any).development);
const parseJson = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;

async function main() {
  const [creator] = await db('users').join('user_roles', 'user_roles.user_id', 'users.id').join('roles', 'roles.id', 'user_roles.role_id')
    .where('roles.slug', 'super_admin').where('users.status_id', db('user_statuses').where('slug', 'active').select('id').limit(1))
    .select('users.id', 'users.email').orderByRaw('CASE WHEN users.email = ? THEN 0 ELSE 1 END', [process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'superadmin@viralco.local']).orderBy('users.id').limit(1);
  if (!creator) throw new Error('No existe un Super Admin activo para crear perfiles de impresion');
  const requester = { id: String(creator.id), email: creator.email, globalRoles: [{ slug: 'super_admin' }] };
  const results = [];
  for (const definition of definitions) {
    const [existing] = await db('library_assets').where({ owner_type: 'viralco', type: 'print_profile' })
      .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) = ?", [definition.manifestId]).select('id', 'metadata').limit(1);
    if (!existing) {
      const created = await createPrintProfile({ name: definition.name, profile: definition.profile, appliesToAllEventTypes: true, metadata: { manifestId: definition.manifestId, source: 'kaptura-defaults' } }, requester, { ownerType: 'viralco' });
      results.push({ status: 'created', id: created.asset.id, name: definition.name });
      continue;
    }
    const profile = definition.profile;
    const contentHash = printProfileContentHash(profile as any);
    const baseKey = `viralco/library/print_profile/${definition.manifestId}`;
    const jsonKey = `${baseKey}/profile.json`;
    const jsonBuffer = Buffer.from(JSON.stringify(profile));
    if (!(await r2ObjectExists(jsonKey))) await putR2Object({ key: jsonKey, body: jsonBuffer, contentType: PRINT_PROFILE_MIME });
    const variants = await renderPrintProfileVariants(profile);
    for (const variant of variants) {
      const key = `${baseKey}/${variant.variant}.webp`;
      if (!(await r2ObjectExists(key))) await putR2Object({ key, body: variant.buffer, contentType: 'image/webp' });
      await db('library_asset_variants').insert({ asset_id: existing.id, variant: variant.variant, storage_key: key, file_url: r2PublicUrl(key), mime_type: 'image/webp', width: variant.width, height: variant.height, size_bytes: variant.sizeBytes, created_at: new Date() })
        .onConflict(['asset_id', 'variant']).merge({ storage_key: key, file_url: r2PublicUrl(key), mime_type: 'image/webp', width: variant.width, height: variant.height, size_bytes: variant.sizeBytes });
    }
    const metadata = parseJson(existing.metadata) || {};
    await db('library_assets').where({ id: existing.id }).update({ name: definition.name, storage_key: jsonKey, file_url: r2PublicUrl(jsonKey), preview_url: r2PublicUrl(`${baseKey}/thumb.webp`), mime_type: PRINT_PROFILE_MIME, size_bytes: jsonBuffer.byteLength, metadata: JSON.stringify({ ...metadata, mirrorCompatible: true, templateKind: 'print-profile', contentHash, printProfile: profile }), status: 'active', created_by: creator.id, updated_at: new Date() });
    await db('library_asset_templates').insert({ library_asset_id: existing.id, schema_version: 1, kind: 'print-profile', config: JSON.stringify(profile), content_hash: contentHash, preview_renderer_version: 1, created_at: new Date(), updated_at: new Date() })
      .onConflict('library_asset_id').merge({ schema_version: 1, kind: 'print-profile', config: JSON.stringify(profile), content_hash: contentHash, preview_renderer_version: 1, updated_at: new Date() });
    results.push({ status: 'existing', id: String(existing.id), name: definition.name });
  }
  console.log(JSON.stringify({ creator: creator.email, printProfiles: results }, null, 2));
}

main().then(async () => { await db.destroy(); process.exit(0); }).catch(async (error) => { console.error(error); await db.destroy(); process.exit(1); });
