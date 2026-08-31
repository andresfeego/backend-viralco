require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const knexFactory = require('knex');
const sharp = require('sharp');
const knexConfig = require('../knexfile.cjs');
const manifest = require('../resources/magic-mirror-assets.json');

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
const bucket = required('R2_BUCKET_NAME');
const publicBase = required('R2_BUCKET_PATH').replace(/\/+$/, '');
const r2 = new S3Client({
  region: process.env.R2_BUCKET_REGION || 'auto',
  endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') },
});
const db = knexFactory(knexConfig[process.env.NODE_ENV === 'production' ? 'production' : 'development']);

async function put(key, body, contentType) {
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
  if (existing) return { id: existing.id, skipped: true };
  const [category] = await db('library_asset_categories').where({ slug: item.category }).select('id').limit(1);
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
  return { id: assetId, skipped: false };
}

(async () => {
  try {
    for (const item of manifest) {
      const result = await importItem(item);
      process.stdout.write(`${result.skipped ? 'skip' : 'import'} ${item.id}\n`);
    }
  } finally {
    await db.destroy();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
