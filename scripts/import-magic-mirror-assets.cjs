require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const knexFactory = require('knex');
const sharp = require('sharp');
const knexConfig = require('../knexfile.cjs');
const manifest = require('../resources/magic-mirror-assets.json');
const dryRun = process.argv.includes('--dry-run');

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
  throw new Error(`Formato no soportado: ${file}`);
};

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

async function importItem(item) {
  const sourcePath = path.resolve(root, item.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe ${sourcePath}`);
  const body = fs.readFileSync(sourcePath);
  const mimeType = mimeFor(sourcePath);
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  const originalKey = `viralco/library/magic-mirror/${item.purpose}/${item.id}/${path.basename(sourcePath)}`;
  const [existing] = await db('library_assets').where({ storage_key: originalKey }).select('id').limit(1);
  if (existing) {
    if (targetAccountId && !dryRun) {
      const now = new Date();
      await db('account_library').insert({ account_id: targetAccountId, library_asset_id: existing.id, added_by: createdBy, created_at: now, updated_at: now }).onConflict(['account_id', 'library_asset_id']).ignore();
    }
    return { id: existing.id, status: 'skipped', bytes: body.length };
  }
  const [category] = await db('library_asset_categories').where({ slug: item.category }).select('id').limit(1);
  if (!category) throw new Error(`Categoria no inicializada: ${item.category}`);
  if (dryRun) return { id: null, status: 'ready', bytes: body.length, sha256: digest };
  const now = new Date();
  const fileUrl = await put(originalKey, body, mimeType);
  const metadata = { manifestId: item.id, sha256: digest, mirrorCompatible: true, stage: item.stage || null };
  const [assetId] = await db('library_assets').insert({
    category_id: category?.id || null,
    owner_type: 'viralco',
    owner_account_id: null,
    source_asset_id: null,
    name: item.name,
    type: item.purpose,
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

  if (mimeType.startsWith('image/')) {
    for (const variant of [{ name: 'thumb', size: 160 }, { name: 'card', size: 512 }, { name: 'full', size: 1600 }]) {
      const rendered = await sharp(body, { animated: false }).rotate().resize({ width: variant.size, height: variant.size, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      const key = `viralco/library/magic-mirror/${item.purpose}/${item.id}/${variant.name}.webp`;
      const url = await put(key, rendered.data, 'image/webp');
      await db('library_asset_variants').insert({ asset_id: assetId, variant: variant.name, storage_key: key, file_url: url, mime_type: 'image/webp', width: rendered.info.width, height: rendered.info.height, size_bytes: rendered.info.size, created_at: now });
      if (variant.name === 'thumb') await db('library_assets').where({ id: assetId }).update({ preview_url: url });
    }
  }

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
      if (sources.has(item.source)) throw new Error(`Source duplicado en manifiesto: ${item.source}`);
      ids.add(item.id);
      sources.add(item.source);
    }
    const report = { mode: dryRun ? 'dry-run' : 'import', ready: 0, imported: 0, skipped: 0, failed: 0, bytes: 0 };
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
