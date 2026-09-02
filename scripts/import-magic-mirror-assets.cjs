require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const ffmpegPath = require('ffmpeg-static');
const knexFactory = require('knex');
const sharp = require('sharp');
const knexConfig = require('../knexfile.cjs');
const manifest = require('../resources/magic-mirror-assets.json');
const dryRun = process.argv.includes('--dry-run');
const backendRoot = path.resolve(__dirname, '..');

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Variable ${name} requerida`);
  return value;
};

const mimeFor = (file) => {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.ttf') return 'font/ttf';
  throw new Error(`Formato no soportado: ${file}`);
};

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function sourceFor(item) {
  if (item.sourceUrl) {
    const body = await download(item.sourceUrl);
    return { body, sourcePath: null, fileName: item.fileName || path.basename(new URL(item.sourceUrl).pathname) };
  }
  const sourcePath = path.resolve(item.sourceBase === 'backend' ? backendRoot : root, item.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe ${sourcePath}`);
  return { body: fs.readFileSync(sourcePath), sourcePath, fileName: path.basename(sourcePath) };
}

const root = required('MAGIC_MIRROR_ASSET_ROOT');
const createdBy = required('MAGIC_MIRROR_CREATED_BY');
const targetAccountId = String(process.env.MAGIC_MIRROR_ACCOUNT_ID || '').trim();
const bucket = dryRun ? String(process.env.R2_BUCKET_NAME || '') : required('R2_BUCKET_NAME');
const publicBase = dryRun ? String(process.env.R2_BUCKET_PATH || '').replace(/\/+$/, '') : required('R2_BUCKET_PATH').replace(/\/+$/, '');
const r2 = dryRun ? null : new S3Client({
  region: process.env.R2_BUCKET_REGION || 'auto',
  endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') },
});
const db = knexFactory(knexConfig[process.env.NODE_ENV === 'production' ? 'production' : 'development']);

async function put(key, body, contentType) {
  if (!r2) throw new Error('R2 no disponible en dry-run');
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${publicBase}/${key}`;
}

function videoPoster(sourcePath) {
  if (!ffmpegPath) throw new Error('Binario FFmpeg no disponible');
  for (const seek of ['0.5', '0']) {
    const result = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-ss', seek, '-i', sourcePath,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
    ], { encoding: null, maxBuffer: 50 * 1024 * 1024 });
    if (result.status === 0 && result.stdout?.length) return result.stdout;
  }
  throw new Error(`No se pudo generar poster de ${sourcePath}`);
}

async function ensurePreviewVariants(assetId, item, sourcePath, body, mimeType, preparedFontPreview = null, force = false) {
  const configs = mimeType.startsWith('video/')
    ? [{ name: 'thumb', size: 160 }, { name: 'card', size: 512 }]
    : mimeType.startsWith('font/')
      ? [{ name: 'thumb', size: 160 }, { name: 'card', size: 512 }]
      : [{ name: 'thumb', size: 160 }, { name: 'card', size: 512 }, { name: 'full', size: 1600 }];
  const existing = await db('library_asset_variants').where({ asset_id: assetId }).select('variant', 'file_url');
  const existingByName = new Map(existing.map((variant) => [variant.variant, variant]));
  const missing = configs.filter((variant) => force || !existingByName.has(variant.name));
  if (!missing.length) return 0;
  if (dryRun) return missing.length;

  const fontPreview = mimeType.startsWith('font/')
    ? preparedFontPreview || await (await import('../src/lib/font-preview.mjs')).renderFontPreviewVariants(body)
    : null;
  const previewInput = mimeType.startsWith('video/') ? videoPoster(sourcePath) : body;
  let thumbUrl = existingByName.get('thumb')?.file_url || null;
  for (const variant of missing) {
    const preparedVariant = fontPreview?.variants.find((entry) => entry.variant === variant.name);
    const rendered = preparedVariant
      ? { data: preparedVariant.buffer, info: { width: preparedVariant.width, height: preparedVariant.height, size: preparedVariant.sizeBytes } }
      : await sharp(previewInput, { animated: false }).rotate().resize({
        width: variant.size,
        height: variant.size,
        fit: 'inside',
        withoutEnlargement: true,
      }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const rendererVersion = fontPreview?.metadata?.previewRendererVersion;
    const variantFileName = rendererVersion ? `${variant.name}-v${rendererVersion}.webp` : `${variant.name}.webp`;
    const key = `viralco/library/magic-mirror/${item.purpose}/${item.id}/${variantFileName}`;
    const url = await put(key, rendered.data, 'image/webp');
    await db('library_asset_variants').insert({
      asset_id: assetId,
      variant: variant.name,
      storage_key: key,
      file_url: url,
      mime_type: 'image/webp',
      width: rendered.info.width,
      height: rendered.info.height,
      size_bytes: rendered.info.size,
      created_at: new Date(),
    }).onConflict(['asset_id', 'variant']).merge({
      storage_key: key,
      file_url: url,
      mime_type: 'image/webp',
      width: rendered.info.width,
      height: rendered.info.height,
      size_bytes: rendered.info.size,
    });
    if (variant.name === 'thumb') thumbUrl = url;
  }
  if (thumbUrl) await db('library_assets').where({ id: assetId }).update({ preview_url: thumbUrl, updated_at: new Date() });
  return missing.length;
}

async function syncEventTypes(assetId, eventTypeSlugs = []) {
  if (dryRun) return;
  await db('library_asset_event_types').where({ library_asset_id: assetId }).delete();
  if (!eventTypeSlugs.length) {
    await db('library_assets').where({ id: assetId }).update({ applies_to_all_event_types: true });
    return;
  }
  const eventTypes = await db('event_types').whereIn('slug', eventTypeSlugs).where({ is_active: true }).select('id', 'slug');
  if (eventTypes.length !== eventTypeSlugs.length) throw new Error(`Tipo de evento invalido para ${assetId}`);
  await db('library_assets').where({ id: assetId }).update({ applies_to_all_event_types: false });
  await db('library_asset_event_types').insert(eventTypes.map((eventType) => ({
    library_asset_id: assetId,
    event_type_id: eventType.id,
    created_at: new Date(),
  }))).onConflict(['library_asset_id', 'event_type_id']).ignore();
}

async function importItem(item) {
  const { body, sourcePath, fileName } = await sourceFor(item);
  const mimeType = mimeFor(fileName);
  const imageInfo = mimeType.startsWith('image/') ? await sharp(body, { animated: true }).metadata() : null;
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  if (item.sha256 && item.sha256 !== digest) throw new Error(`SHA-256 invalido para ${item.id}`);
  const originalKey = `viralco/library/magic-mirror/${item.purpose}/${item.id}/${fileName}`;
  const [category] = await db('library_asset_categories').where({ slug: item.category }).select('id').limit(1);
  if (!category) throw new Error(`Categoria no inicializada: ${item.category}`);
  const [existing] = await db('library_assets')
    .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) = ?", [item.id])
    .orWhere({ storage_key: originalKey })
    .select('id', 'metadata')
    .limit(1);
  const fontPreview = mimeType.startsWith('font/')
    ? await (await import('../src/lib/font-preview.mjs')).renderFontPreviewVariants(body)
    : null;
  let licenseStorageKey = null;
  if (item.licenseUrl && !dryRun) {
    const licenseBody = await download(item.licenseUrl);
    licenseStorageKey = `viralco/library/magic-mirror/${item.purpose}/${item.id}/OFL.txt`;
    await put(licenseStorageKey, licenseBody, 'text/plain');
  }
  const currentMetadata = typeof existing?.metadata === 'string' ? JSON.parse(existing.metadata) : existing?.metadata || {};
  const refreshFontPreviews = Boolean(fontPreview)
    && Number(currentMetadata.previewRendererVersion || 0) < Number(fontPreview.metadata.previewRendererVersion || 0);
  const metadata = {
    ...currentMetadata,
    manifestId: item.id,
    sha256: digest,
    mirrorCompatible: true,
    stage: item.stage || null,
    ...(imageInfo ? {
      width: imageInfo.width,
      height: imageInfo.pageHeight || imageInfo.height,
      aspectRatio: imageInfo.width && (imageInfo.pageHeight || imageInfo.height)
        ? imageInfo.width / (imageInfo.pageHeight || imageInfo.height)
        : null,
      hasTransparency: Boolean(imageInfo.hasAlpha),
      frameCount: imageInfo.pages || 1,
    } : {}),
    ...(fontPreview?.metadata || {}),
    ...(item.author ? { author: item.author } : {}),
    ...(item.licenseUrl ? { license: 'OFL-1.1', licenseUrl: item.licenseUrl, licenseStorageKey } : {}),
    ...(item.sourceUrl ? { sourceUrl: item.sourceUrl, sourceCommit: 'f6b2b7e8545e086ad3f821af21895d732b6485cf' } : {}),
  };
  if (existing) {
    if (!dryRun) await db('library_assets').where({ id: existing.id }).update({
      category_id: category.id,
      name: item.name,
      type: item.purpose,
      motion_type: item.motionType || null,
      metadata: JSON.stringify(metadata),
      updated_at: new Date(),
    });
    await syncEventTypes(existing.id, item.eventTypes || []);
    const repairedVariants = await ensurePreviewVariants(existing.id, item, sourcePath, body, mimeType, fontPreview, refreshFontPreviews);
    if (targetAccountId && !dryRun) {
      const now = new Date();
      await db('account_library').insert({ account_id: targetAccountId, library_asset_id: existing.id, added_by: createdBy, created_at: now, updated_at: now }).onConflict(['account_id', 'library_asset_id']).ignore();
    }
    return { id: existing.id, status: repairedVariants ? (dryRun ? 'ready' : 'repaired') : 'skipped', bytes: body.length };
  }
  if (dryRun) return { id: null, status: 'ready', bytes: body.length, sha256: digest };
  const now = new Date();
  const fileUrl = await put(originalKey, body, mimeType);
  const [assetId] = await db('library_assets').insert({
    category_id: category?.id || null,
    owner_type: 'viralco',
    owner_account_id: null,
    source_asset_id: null,
    name: item.name,
    type: item.purpose,
    motion_type: item.motionType || null,
    applies_to_all_event_types: !(item.eventTypes || []).length,
    storage_key: originalKey,
    file_url: fileUrl,
    preview_url: null,
    mime_type: mimeType,
    size_bytes: body.length,
    tags: JSON.stringify(['espejo', item.purpose]),
    metadata: JSON.stringify(metadata),
    status: 'active',
    created_by: createdBy,
    created_at: now,
    updated_at: now,
  });

  await syncEventTypes(assetId, item.eventTypes || []);
  await ensurePreviewVariants(assetId, item, sourcePath, body, mimeType, fontPreview);

  if (targetAccountId) {
    await db('account_library').insert({ account_id: targetAccountId, library_asset_id: assetId, added_by: createdBy, created_at: now, updated_at: now }).onConflict(['account_id', 'library_asset_id']).ignore();
  }
  return { id: assetId, status: 'imported', bytes: body.length };
}

(async () => {
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Raiz de assets invalida: ${root}`);
    const [creator] = await db('users').where({ id: createdBy }).select('id').limit(1);
    if (!creator) throw new Error(`MAGIC_MIRROR_CREATED_BY no existe: ${createdBy}`);
    if (targetAccountId) {
      const [account] = await db('accounts').where({ id: targetAccountId }).select('id').limit(1);
      if (!account) throw new Error(`MAGIC_MIRROR_ACCOUNT_ID no existe: ${targetAccountId}`);
    }
    const ids = new Set();
    const sources = new Set();
    for (const item of manifest) {
      if (ids.has(item.id)) throw new Error(`ID duplicado en manifiesto: ${item.id}`);
      const source = item.source || item.sourceUrl;
      if (sources.has(source)) throw new Error(`Source duplicado en manifiesto: ${source}`);
      ids.add(item.id);
      sources.add(source);
    }
    const report = { mode: dryRun ? 'dry-run' : 'import', ready: 0, imported: 0, repaired: 0, skipped: 0, failed: 0, bytes: 0 };
    for (const item of manifest) {
      try {
        const result = await importItem(item);
        report[result.status] += 1;
        report.bytes += result.bytes || 0;
        process.stdout.write(`${result.status} ${item.id}\n`);
      } catch (error) {
        report.failed += 1;
        process.stderr.write(`failed ${item.id}: ${error.message}\n`);
      }
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.failed) process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
