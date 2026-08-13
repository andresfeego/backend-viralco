import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ServiceError } from './lib/service-error.ts';

export const LIBRARY_PURPOSES = new Set([
  'frame',
  'overlay',
  'intro',
  'outro',
  'music',
  'logo',
  'background',
  'template',
  'branding',
  'other',
]);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const SIGNED_UPLOAD_EXPIRES_IN = 300;

function requiredEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new ServiceError(500, `Variable ${name} requerida`);
  return value;
}

function r2Client() {
  const accountId = requiredEnv('R2_ACCOUNT_ID');
  return new S3Client({
    region: process.env.R2_BUCKET_REGION || 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

export const r2 = r2Client();

function safeFileName(fileName: string) {
  const parsed = path.parse(fileName);
  const base = parsed.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'file';
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
  return `${base}${ext}`;
}

function assertContentTypeForPurpose(purpose: string, contentType: string) {
  if (purpose === 'music') {
    if (!AUDIO_TYPES.has(contentType)) throw new ServiceError(400, 'Tipo de audio no permitido');
    return;
  }
  if (purpose === 'intro' || purpose === 'outro') {
    if (!IMAGE_TYPES.has(contentType) && !VIDEO_TYPES.has(contentType)) throw new ServiceError(400, 'Tipo de archivo no permitido');
    return;
  }
  if (!IMAGE_TYPES.has(contentType)) throw new ServiceError(400, 'Tipo de imagen no permitido');
}

export function assertLibraryUploadInput(input: any) {
  const purpose = String(input?.purpose || '').trim();
  const contentType = String(input?.contentType || '').trim().toLowerCase();
  const rawFileName = String(input?.fileName || '').trim();
  const sizeBytes = Number(input?.sizeBytes);

  if (!LIBRARY_PURPOSES.has(purpose)) throw new ServiceError(400, 'Proposito de upload invalido');
  assertContentTypeForPurpose(purpose, contentType);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) throw new ServiceError(400, 'Tamano de archivo invalido');
  if (!rawFileName) throw new ServiceError(400, 'Nombre de archivo requerido');

  return { purpose, contentType, fileName: safeFileName(rawFileName), sizeBytes };
}

export function buildLibraryUploadKey(input: { scope: 'viralco' | 'account'; accountId?: string; purpose: string; fileName: string }) {
  const prefix = input.scope === 'viralco' ? 'viralco/library' : `accounts/${input.accountId}/library`;
  return `${prefix}/${input.purpose}/${randomUUID()}-${input.fileName}`;
}

export function buildLibraryAssetVariantKey(input: { scope: 'viralco' | 'account'; accountId?: string; purpose: string; assetId: string; variant: string }) {
  const prefix = input.scope === 'viralco' ? 'viralco/library' : `accounts/${input.accountId}/library`;
  return `${prefix}/${input.purpose}/${input.assetId}/${input.variant}.webp`;
}

export function r2PublicUrl(key: string) {
  const basePath = requiredEnv('R2_BUCKET_PATH').replace(/\/+$/g, '');
  return `${basePath}/${key}`;
}

export function assertLibraryKeyScope(input: { key: string; ownerType: 'viralco' | 'account'; accountId?: string }) {
  const key = String(input.key || '').trim();
  const expectedPrefix = input.ownerType === 'viralco' ? 'viralco/library/' : `accounts/${input.accountId}/library/`;
  if (!key.startsWith(expectedPrefix)) throw new ServiceError(400, 'Key de archivo no coincide con el propietario');
  return key;
}

export async function createPresignedLibraryUpload(input: {
  scope: 'viralco' | 'account';
  accountId?: string;
  purpose: string;
  contentType: string;
  fileName: string;
}) {
  const key = buildLibraryUploadKey(input);
  const command = new PutObjectCommand({
    Bucket: requiredEnv('R2_BUCKET_NAME'),
    Key: key,
    ContentType: input.contentType,
  });
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: SIGNED_UPLOAD_EXPIRES_IN });
  return { uploadUrl, method: 'PUT', key, fileUrl: r2PublicUrl(key), expiresIn: SIGNED_UPLOAD_EXPIRES_IN };
}

export async function putR2Object(input: { key: string; body: Buffer; contentType: string }) {
  await r2.send(new PutObjectCommand({
    Bucket: requiredEnv('R2_BUCKET_NAME'),
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
  }));
  return { key: input.key, fileUrl: r2PublicUrl(input.key) };
}
