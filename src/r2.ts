import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
  'print_profile',
  'animation',
  'sticker',
  'font',
  'branding',
  'other',
]);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'image/gif']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const FONT_TYPES = new Set(['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-sfnt']);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const SIGNED_UPLOAD_EXPIRES_IN = 300;
const SIGNED_READ_EXPIRES_IN = 900;
const RUNTIME_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_RUNTIME_UPLOAD_BYTES = 50 * 1024 * 1024;

function requiredEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new ServiceError(500, `Variable ${name} requerida`);
  return value;
}

function r2Client() {
  const accountId = requiredEnv('R2_ACCOUNT_ID');
  return new S3Client({
    requestChecksumCalculation: 'WHEN_REQUIRED',
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
  if (purpose === 'font') {
    if (!FONT_TYPES.has(contentType)) throw new ServiceError(400, 'Tipo de fuente no permitido');
    return;
  }
  if (purpose === 'intro' || purpose === 'outro' || purpose === 'animation') {
    if (!IMAGE_TYPES.has(contentType) && !VIDEO_TYPES.has(contentType)) throw new ServiceError(400, 'Tipo de archivo no permitido');
    return;
  }
  if (purpose === 'sticker') {
    if (!['image/png', 'image/gif'].includes(contentType)) throw new ServiceError(400, 'El sticker debe ser PNG o GIF');
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
  if (purpose === 'template' || purpose === 'print_profile') throw new ServiceError(400, 'Este recurso se crea desde su formulario de configuracion');
  assertContentTypeForPurpose(purpose, contentType);
  const maxBytes = VIDEO_TYPES.has(contentType) ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) throw new ServiceError(400, 'Tamano de archivo invalido');
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

export async function getR2ObjectBuffer(key: string) {
  const result = await r2.send(new GetObjectCommand({ Bucket: requiredEnv('R2_BUCKET_NAME'), Key: key }));
  if (!result.Body) throw new ServiceError(404, 'Objeto R2 no encontrado');
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function r2ObjectExists(key: string) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: requiredEnv('R2_BUCKET_NAME'), Key: key }));
    return true;
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return false;
    throw error;
  }
}

export async function deleteR2Objects(keys: string[]) {
  const uniqueKeys = [...new Set(keys.map((key) => String(key || '').trim()).filter(Boolean))];
  for (let offset = 0; offset < uniqueKeys.length; offset += 1000) {
    const batch = uniqueKeys.slice(offset, offset + 1000);
    await r2.send(new DeleteObjectsCommand({
      Bucket: requiredEnv('R2_BUCKET_NAME'),
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
  }
  return uniqueKeys.length;
}

export async function createPresignedReadUrl(key: string) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return '';
  const command = new GetObjectCommand({
    Bucket: requiredEnv('R2_BUCKET_NAME'),
    Key: normalizedKey,
  });
  return getSignedUrl(r2, command, { expiresIn: SIGNED_READ_EXPIRES_IN });
}

export function assertRuntimeUploadInput(input: any) {
  const contentType = String(input?.contentType || '').trim().toLowerCase();
  const sizeBytes = Number(input?.sizeBytes);
  const sha256 = String(input?.sha256 || '').trim().toLowerCase();
  if (!RUNTIME_UPLOAD_TYPES.has(contentType)) throw new ServiceError(400, 'Formato de captura no permitido');
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_RUNTIME_UPLOAD_BYTES) throw new ServiceError(400, 'Tamano de captura invalido');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ServiceError(400, 'Hash de captura invalido');
  return { contentType, sizeBytes, sha256 };
}

export function buildMirrorRuntimeKey(input: { accountId: string; eventId: string; sessionId: string; kind: 'captures' | 'deliverables'; clientId: string; contentType: string }) {
  const extension = input.contentType === 'image/png' ? 'png' : 'jpg';
  return `accounts/${input.accountId}/events/${input.eventId}/mirror/${input.sessionId}/${input.kind}/${input.clientId}.${extension}`;
}

export async function createPresignedRuntimeUpload(input: { key: string; contentType: string; sha256: string }) {
  const command = new PutObjectCommand({
    Bucket: requiredEnv('R2_BUCKET_NAME'),
    Key: input.key,
    ContentType: input.contentType,
    Metadata: { sha256: input.sha256 },
  });
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: SIGNED_UPLOAD_EXPIRES_IN, unhoistableHeaders: new Set(['x-amz-meta-sha256']) });
  return {
    uploadUrl,
    method: 'PUT',
    requiredHeaders: { 'Content-Type': input.contentType, 'x-amz-meta-sha256': input.sha256 },
    expiresIn: SIGNED_UPLOAD_EXPIRES_IN,
  };
}

export async function headR2Object(key: string) {
  try {
    const result = await r2.send(new HeadObjectCommand({ Bucket: requiredEnv('R2_BUCKET_NAME'), Key: key }));
    return {
      sizeBytes: Number(result.ContentLength || 0),
      contentType: String(result.ContentType || ''),
      sha256: String(result.Metadata?.sha256 || '').toLowerCase(),
    };
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') throw new ServiceError(409, 'El archivo aun no existe en almacenamiento');
    throw error;
  }
}
