require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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
  if (item.sourceBase !== 'backend' && !root) throw new Error(`Define GLOBAL_LIBRARY_ASSET_ROOT si el objeto ${item.id} no existe en R2`);
  const sourcePath = path.resolve(item.sourceBase === 'backend' ? backendRoot : root, item.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe ${sourcePath}`);
  return { body: fs.readFileSync(sourcePath), sourcePath, fileName: path.basename(sourcePath) };
}

const root = String(process.env.GLOBAL_LIBRARY_ASSET_ROOT || process.env.MAGIC_MIRROR_ASSET_ROOT || '').trim();
let createdBy = String(process.env.GLOBAL_LIBRARY_CREATED_BY || process.env.MAGIC_MIRROR_CREATED_BY || '').trim();
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

async function headObject(key) {
  if (!r2) return null;
  try {
    const result = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { contentType: result.ContentType || null, sizeBytes: Number(result.ContentLength || 0) };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

async function getObject(key) {
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}

async function listObjectKeys(prefix) {
  const keys = [];
  let continuationToken;
  do {
    const result = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    keys.push(...(result.Contents || []).map((entry) => entry.Key).filter(Boolean));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function expectedVariantNames(mimeType) {
  if (mimeType.startsWith('video/') || mimeType.startsWith('font/')) return ['thumb', 'card'];
  return ['thumb', 'card', 'full'];
}

async function restorePreviewVariantsFromR2(assetId, item, mimeType) {
  if (dryRun) return { restored: 0, complete: false };
  const prefix = `viralco/library/magic-mirror/${item.purpose}/${item.id}/`;
  const keys = await listObjectKeys(prefix);
  let restored = 0;
  for (const variant of expectedVariantNames(mimeType)) {
    const candidates = keys.filter((key) => {
      const fileName = path.basename(key);
      return fileName === `${variant}.webp` || (fileName.startsWith(`${variant}-v`) && fileName.endsWith('.webp'));
    }).sort().reverse();
    const key = candidates[0];
    if (!key) continue;
    const [existing] = await db('library_asset_variants').where({ asset_id: assetId, variant }).select('id').limit(1);
    if (existing) continue;
    const buffer = await getObject(key);
    const image = await sharp(buffer).metadata();
    await db('library_asset_variants').insert({
      asset_id: assetId,
      variant,
      storage_key: key,
      file_url: `${publicBase}/${key}`,
      mime_type: 'image/webp',
      width: image.width || null,
      height: image.height || null,
      size_bytes: buffer.length,
      created_at: new Date(),
    }).onConflict(['asset_id', 'variant']).ignore();
    restored += 1;
  }
  const existing = await db('library_asset_variants').where({ asset_id: assetId }).whereIn('variant', expectedVariantNames(mimeType)).select('variant', 'file_url');
  const thumb = existing.find((entry) => entry.variant === 'thumb');
  if (thumb) await db('library_assets').where({ id: assetId }).update({ preview_url: thumb.file_url, updated_at: new Date() });
  return { restored, complete: new Set(existing.map((entry) => entry.variant)).size === expectedVariantNames(mimeType).length };
}

async function restoreOriginalMetadataFromR2(originalKey, item, mimeType, currentMetadata = {}) {
  const needsImageMetadata = mimeType.startsWith('image/') && !currentMetadata.width;
  const needsFontMetadata = mimeType.startsWith('font/') && !currentMetadata.familyName;
  if (!needsImageMetadata && !needsFontMetadata) return {};
  const body = await getObject(originalKey);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  if (item.sha256 && item.sha256 !== digest) throw new Error(`SHA-256 invalido en R2 para ${item.id}`);
  if (needsFontMetadata) {
    const fontPreview = await (await import('../src/lib/font-preview.mjs')).renderFontPreviewVariants(body);
    return { sha256: digest, ...fontPreview.metadata };
  }
  const imageInfo = await sharp(body, { animated: true }).metadata();
  const height = imageInfo.pageHeight || imageInfo.height;
  return {
    sha256: digest,
    width: imageInfo.width,
    height,
    aspectRatio: imageInfo.width && height ? imageInfo.width / height : null,
    hasTransparency: Boolean(imageInfo.hasAlpha),
    frameCount: imageInfo.pages || 1,
  };
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
  const fileName = item.fileName || path.basename(item.source || new URL(item.sourceUrl).pathname);
  const mimeType = mimeFor(fileName);
  const originalKey = `viralco/library/magic-mirror/${item.purpose}/${item.id}/${fileName}`;
  const [category] = await db('library_asset_categories').where({ slug: item.category }).select('id').limit(1);
  if (!category) throw new Error(`Categoria no inicializada: ${item.category}`);
  const [existing] = await db('library_assets')
    .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) = ?", [item.id])
    .orWhere({ storage_key: originalKey })
    .select('id', 'metadata')
    .limit(1);
  const r2Original = dryRun ? null : await headObject(originalKey);
  const baseMetadata = {
    manifestId: item.id,
    sha256: item.sha256 || null,
    mirrorCompatible: true,
    stage: item.stage || null,
    ...(item.author ? { author: item.author } : {}),
    ...(item.licenseUrl ? {
      license: 'OFL-1.1',
      licenseUrl: item.licenseUrl,
      licenseStorageKey: `viralco/library/magic-mirror/${item.purpose}/${item.id}/OFL.txt`,
    } : {}),
    ...(item.sourceUrl ? { sourceUrl: item.sourceUrl, sourceCommit: 'f6b2b7e8545e086ad3f821af21895d732b6485cf' } : {}),
  };
  if (existing && r2Original) {
    const currentMetadata = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : existing.metadata || {};
    const requiredFontPreviewVersion = mimeType.startsWith('font/')
      ? (await import('../src/lib/font-preview.mjs')).FONT_PREVIEW_RENDERER_VERSION
      : null;
    const restoredMetadata = await restoreOriginalMetadataFromR2(originalKey, item, mimeType, currentMetadata);
    if (!dryRun) await db('library_assets').where({ id: existing.id }).update({
      owner_type: 'viralco', owner_account_id: null, category_id: category.id, name: item.name,
      type: item.purpose, motion_type: item.motionType || null, applies_to_all_event_types: !(item.eventTypes || []).length,
      storage_key: originalKey, file_url: `${publicBase}/${originalKey}`, mime_type: mimeType,
      size_bytes: r2Original.sizeBytes || null, metadata: JSON.stringify({ ...currentMetadata, ...baseMetadata, ...restoredMetadata }),
      status: 'active', created_by: createdBy, updated_at: new Date(),
    });
    await syncEventTypes(existing.id, item.eventTypes || []);
    const restored = await restorePreviewVariantsFromR2(existing.id, item, mimeType);
    const previewsAreCurrent = !requiredFontPreviewVersion
      || Number(currentMetadata.previewRendererVersion || 0) >= Number(requiredFontPreviewVersion);
    if (restored.complete && previewsAreCurrent) {
      if (targetAccountId && !dryRun) {
        const now = new Date();
        await db('account_library').insert({ account_id: targetAccountId, library_asset_id: existing.id, added_by: createdBy, created_at: now, updated_at: now }).onConflict(['account_id', 'library_asset_id']).ignore();
      }
      return { id: existing.id, status: restored.restored ? 'repaired' : 'skipped', bytes: r2Original.sizeBytes || 0 };
    }
  }

  if (!existing && r2Original && !dryRun) {
    const now = new Date();
    const restoredMetadata = await restoreOriginalMetadataFromR2(originalKey, item, mimeType);
    const [assetId] = await db('library_assets').insert({
      category_id: category.id, owner_type: 'viralco', owner_account_id: null, source_asset_id: null,
      name: item.name, type: item.purpose, motion_type: item.motionType || null,
      applies_to_all_event_types: !(item.eventTypes || []).length,
      storage_key: originalKey, file_url: `${publicBase}/${originalKey}`, preview_url: null,
      mime_type: mimeType, size_bytes: r2Original.sizeBytes || null,
      tags: JSON.stringify(['espejo', item.purpose]), metadata: JSON.stringify({ ...baseMetadata, ...restoredMetadata }), status: 'active',
      created_by: createdBy, created_at: now, updated_at: now,
    });
    await syncEventTypes(assetId, item.eventTypes || []);
    const restored = await restorePreviewVariantsFromR2(assetId, item, mimeType);
    if (!restored.complete) throw new Error(`R2 no contiene todas las variantes de ${item.id}; define GLOBAL_LIBRARY_ASSET_ROOT para repararlas`);
    if (targetAccountId) await db('account_library').insert({ account_id: targetAccountId, library_asset_id: assetId, added_by: createdBy, created_at: now, updated_at: now }).onConflict(['account_id', 'library_asset_id']).ignore();
    return { id: assetId, status: 'restored', bytes: r2Original.sizeBytes || 0 };
  }

  const { body, sourcePath } = await sourceFor(item);
  const imageInfo = mimeType.startsWith('image/') ? await sharp(body, { animated: true }).metadata() : null;
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  if (item.sha256 && item.sha256 !== digest) throw new Error(`SHA-256 invalido para ${item.id}`);
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
    ...baseMetadata,
    sha256: digest,
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
    ...(item.licenseUrl ? { licenseStorageKey } : {}),
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
    if (root && (!fs.existsSync(root) || !fs.statSync(root).isDirectory())) throw new Error(`Raiz de assets invalida: ${root}`);
    if (!createdBy) {
      const canonicalEmail = String(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'superadmin@viralco.local').trim().toLowerCase();
      const [canonical] = await db('users as u')
        .join('user_roles as ur', 'ur.user_id', 'u.id')
        .join('roles as r', 'r.id', 'ur.role_id')
        .where({ 'u.email': canonicalEmail, 'r.slug': 'super_admin' })
        .select('u.id')
        .limit(1);
      if (!canonical) throw new Error(`No existe el Super Admin canonico ${canonicalEmail}`);
      createdBy = String(canonical.id);
    }
    const [creator] = await db('users').where({ id: createdBy }).select('id').limit(1);
    if (!creator) throw new Error(`GLOBAL_LIBRARY_CREATED_BY no existe: ${createdBy}`);
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
    const report = { mode: dryRun ? 'dry-run' : 'import', ready: 0, imported: 0, restored: 0, repaired: 0, skipped: 0, failed: 0, bytes: 0 };
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
