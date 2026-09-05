import 'dotenv/config';
import knexFactory from 'knex';
import knexConfig from '../knexfile.cjs';
import { createPhotoLayoutTemplate } from '../src/services/photo-layout-template.service.ts';
import { PHOTO_LAYOUT_PREVIEW_RENDERER_VERSION, PHOTO_LAYOUT_TEMPLATE_MIME, photoLayoutContentHash } from '../src/domain/photo-layout-template.ts';
import { renderPhotoLayoutTemplateVariants } from '../src/lib/photo-layout-preview.mjs';
import { putR2Object, r2ObjectExists, r2PublicUrl } from '../src/r2.ts';
import templateDefinitions from '../resources/photo-layout-templates.json';

const db = knexFactory((knexConfig as any).development);

const templates = templateDefinitions;

function parseJson(value: any) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function main() {
  const [creator] = await db('users')
    .join('user_roles', 'user_roles.user_id', 'users.id')
    .join('roles', 'roles.id', 'user_roles.role_id')
    .where('roles.slug', 'super_admin')
    .where('users.status_id', db('user_statuses').where('slug', 'active').select('id').limit(1))
    .select('users.id', 'users.email')
    .orderByRaw('CASE WHEN users.email = ? THEN 0 ELSE 1 END', [process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'superadmin@viralco.local'])
    .orderBy('users.id')
    .limit(1);
  if (!creator) throw new Error('No existe un Super Admin activo para crear las plantillas');
  const requester = { id: String(creator.id), email: creator.email, globalRoles: [{ slug: 'super_admin' }] };
  const results = [];
  for (const definition of templates) {
    const [existing] = await db('library_assets')
      .where({ owner_type: 'viralco', type: 'template' })
      .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) = ?", [definition.manifestId])
      .select('id', 'name', 'metadata')
      .limit(1);
    if (existing) {
      const [record] = await db('library_asset_templates').where({ library_asset_id: existing.id }).select('config', 'content_hash', 'preview_renderer_version').limit(1);
      if (!record?.config) throw new Error(`La plantilla ${definition.manifestId} no tiene configuracion`);
      const template = definition.template;
      const contentHash = photoLayoutContentHash(template as any);
      const templateChanged = JSON.stringify(parseJson(record.config)) !== JSON.stringify(template);
      const rendererChanged = Number(record.preview_renderer_version) !== PHOTO_LAYOUT_PREVIEW_RENDERER_VERSION;
      const baseKey = `viralco/library/template/${definition.manifestId}`;
      const jsonKey = `${baseKey}/template.json`;
      const jsonBuffer = Buffer.from(JSON.stringify(template));
      if (templateChanged || !(await r2ObjectExists(jsonKey))) {
        await putR2Object({ key: jsonKey, body: jsonBuffer, contentType: PHOTO_LAYOUT_TEMPLATE_MIME });
      }
      const variants = await renderPhotoLayoutTemplateVariants(template);
      for (const variant of variants) {
        const key = `${baseKey}/${variant.variant}.webp`;
        if (templateChanged || rendererChanged || !(await r2ObjectExists(key))) {
          await putR2Object({ key, body: variant.buffer, contentType: 'image/webp' });
        }
        await db('library_asset_variants').insert({
          asset_id: existing.id, variant: variant.variant,
          storage_key: key, file_url: r2PublicUrl(key), mime_type: 'image/webp', width: variant.width,
          height: variant.height, size_bytes: variant.sizeBytes, created_at: new Date(),
        }).onConflict(['asset_id', 'variant']).merge({
          storage_key: key, file_url: r2PublicUrl(key), mime_type: 'image/webp', width: variant.width,
          height: variant.height, size_bytes: variant.sizeBytes,
        });
      }
      await db('library_asset_templates').where({ library_asset_id: existing.id }).update({
        config: JSON.stringify(template), content_hash: contentHash,
        preview_renderer_version: PHOTO_LAYOUT_PREVIEW_RENDERER_VERSION, updated_at: new Date(),
      });
      const metadata = parseJson(existing.metadata) || {};
      await db('library_assets').where({ id: existing.id }).update({
        created_by: creator.id, name: definition.name, storage_key: jsonKey, file_url: r2PublicUrl(jsonKey),
        preview_url: r2PublicUrl(`${baseKey}/thumb.webp`), mime_type: PHOTO_LAYOUT_TEMPLATE_MIME, size_bytes: jsonBuffer.byteLength,
        metadata: JSON.stringify({ ...metadata, mirrorCompatible: true, templateKind: 'mirror-photo-layout', contentHash }), updated_at: new Date(),
      });
      results.push({ status: templateChanged || rendererChanged ? 'updated' : 'existing', id: String(existing.id), name: definition.name });
      continue;
    }
    const created = await createPhotoLayoutTemplate({
      name: definition.name,
      template: definition.template,
      appliesToAllEventTypes: true,
      metadata: { manifestId: definition.manifestId, source: 'kaptura-defaults' },
    }, requester, { ownerType: 'viralco' });
    results.push({ status: 'created', id: created.asset.id, name: created.asset.name });
  }
  console.log(JSON.stringify({ creator: creator.email, templates: results }, null, 2));
}

main()
  .then(async () => { await db.destroy(); process.exit(0); })
  .catch(async (error) => { console.error(error); await db.destroy(); process.exit(1); });
