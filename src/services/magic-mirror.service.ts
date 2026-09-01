import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  eventModeConfigsTable,
  eventModeConfigVersionsTable,
  eventModeSessionsTable,
  eventModesTable,
  eventResourcesTable,
  eventsTable,
  libraryAssetsTable,
  modesTable,
} from '../db/schema.ts';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { validateMirrorConfigLocally as validateMirrorConfigContract } from '../domain/magic-mirror-config.ts';
import { assertAccountAccess } from './account-access.service.ts';
import { getLibraryAssetWithVariants } from './library.service.ts';
import { assertSubscriptionIncludesModes } from './subscriptions.service.ts';

export const MIRROR_SCHEMA_VERSION = 1;

export const MIRROR_ANIMATION_STAGES = [
  'beforeCountdown',
  'afterCapture',
  'countdown',
  'pickMusic',
  'beforeSignature',
  'processing',
  'afterProcessing',
  'sessionEnd',
] as const;

export const MIRROR_FORMATS = {
  digital: { width: 1200, height: 1500, minShots: 1, maxShots: 1, duplicateStrip: false },
  doble: { width: 1200, height: 1500, minShots: 2, maxShots: 2, duplicateStrip: false },
  recuerdo: { width: 1200, height: 1800, minShots: 3, maxShots: 3, duplicateStrip: false },
  tira: { width: 600, height: 1800, minShots: 3, maxShots: 3, duplicateStrip: true },
  'personalizar-5x15': { width: 2000, height: 2960, minShots: 1, maxShots: 8, duplicateStrip: true },
  postal: { width: 1800, height: 1200, minShots: 1, maxShots: 1, duplicateStrip: false },
  collage: { width: 1600, height: 1200, minShots: 4, maxShots: 4, duplicateStrip: false },
  'digital-vertical': { width: 1080, height: 1920, minShots: 1, maxShots: 1, duplicateStrip: false, legacy: true },
} as const;

const MIRROR_TEXT_LAYER_IDS = new Set(['script', 'name', 'event', 'date']);
const MIRROR_TEXT_FONTS = new Set(['arial', 'georgia', 'impact', 'verdana', 'courier', 'resource']);
const MIRROR_LENSES = new Set(['normal', 'wide', 'ultra-wide']);
const MIRROR_QUALITIES = new Set(['medium', 'high', 'superior']);
const MIRROR_EXPERIENCE_STYLES = new Set(['video-vertical', 'minimal', 'party']);
const MIRROR_ANIMATION_STAGE_SET = new Set<string>(MIRROR_ANIMATION_STAGES);

export const defaultMirrorConfig = () => ({
  layout: {
    format: 'digital',
    output: { width: 1200, height: 1500 },
    shotCount: 1,
    order: [1],
    slots: [{ photoNumber: 1, x: 7, y: 17, width: 86, height: 66 }],
    duplicateStrip: false,
    textLayers: [],
  },
  resources: {
    templateResourceId: null,
    frameResourceId: null,
    gifOverlayResourceId: null,
    startScreenResourceId: null,
    backgroundResourceId: null,
    fontResourceId: null,
    animationResourceIds: [],
  },
  capture: {
    firstCountdownSeconds: 5,
    nextCountdownSeconds: 5,
    reviewSeconds: 5,
    flashEnabled: true,
    lens: 'wide',
    quality: 'high',
    preserveOriginals: true,
    roamingMode: false,
  },
  experience: { style: 'video-vertical', virtualAssistantEnabled: true, randomByStage: {} },
  gif: { enabled: false, captureCount: 2, delayMs: 300, reverse: false, size: 'vertical-720' },
  backgroundRemoval: { enabled: false, mode: 'automatic', finalBackground: 'transparent', edgeSoftness: 'medium', keepShadow: true },
  print: { enabled: false, paperWidthCm: 10, paperHeightCm: 14.8, orientation: 'portrait', dpi: 300, marginCm: 0, copies: 1, fit: 'contain', twoPerPage: false },
  delivery: { qr: true, share: true, download: true, print: false },
  runtime: { autoResetSeconds: 15, operatorMenuEnabled: true },
});

type ValidationIssue = { path: string; code: string; message: string };

function parseJson(value: any) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function boundedInteger(value: any, min: number, max: number) {
  return Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

function isBoolean(value: unknown) {
  return typeof value === 'boolean';
}

function finiteInRange(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

export function validateMirrorConfigLocally(config: any, publish = false) {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [issue('config', 'CONFIG_INVALID', 'La configuracion debe ser un objeto')], warnings };
  }
  const layout = config.layout || {};
  const shotCount = Number(layout.shotCount);
  const format = String(layout.format || '');
  const formatSpec = MIRROR_FORMATS[format as keyof typeof MIRROR_FORMATS];
  if (!formatSpec) {
    errors.push(issue('layout.format', 'FORMAT_INVALID', 'Selecciona un formato de Espejo valido'));
  } else {
    if (!boundedInteger(shotCount, formatSpec.minShots, formatSpec.maxShots)) {
      errors.push(issue('layout.shotCount', 'SHOT_COUNT_INVALID', `La cantidad de tomas para ${format} debe estar entre ${formatSpec.minShots} y ${formatSpec.maxShots}`));
    }
    if (Number(layout.output?.width) !== formatSpec.width || Number(layout.output?.height) !== formatSpec.height) {
      errors.push(issue('layout.output', 'OUTPUT_FORMAT_MISMATCH', `El formato ${format} requiere salida ${formatSpec.width} x ${formatSpec.height}`));
    }
    if (layout.duplicateStrip === true && !formatSpec.duplicateStrip) {
      errors.push(issue('layout.duplicateStrip', 'DUPLICATE_STRIP_UNAVAILABLE', 'La tira duplicada no esta disponible para este formato'));
    }
  }
  if (!isBoolean(layout.duplicateStrip)) errors.push(issue('layout.duplicateStrip', 'BOOLEAN_REQUIRED', 'La tira duplicada debe ser booleana'));
  const slots = Array.isArray(layout.slots) ? layout.slots : [];
  if (slots.length !== shotCount) errors.push(issue('layout.slots', 'SLOTS_COUNT_INVALID', 'Debe existir un slot por toma'));
  const order = Array.isArray(layout.order) ? layout.order.map(Number) : [];
  const expectedOrder = Array.from({ length: shotCount }, (_, index) => index + 1);
  if (order.length !== shotCount || new Set(order).size !== shotCount || order.some((value) => !expectedOrder.includes(value))) {
    errors.push(issue('layout.order', 'SHOT_ORDER_INVALID', 'El orden debe incluir cada toma exactamente una vez'));
  }
  const slotPhotoNumbers = slots.map((slot: any) => Number(slot?.photoNumber));
  if (new Set(slotPhotoNumbers).size !== slots.length || slotPhotoNumbers.some((value) => !expectedOrder.includes(value))) {
    errors.push(issue('layout.slots', 'SLOT_PHOTO_NUMBER_INVALID', 'Cada slot debe corresponder a una toma unica'));
  }
  slots.forEach((slot: any, index: number) => {
    const values = [slot?.x, slot?.y, slot?.width, slot?.height].map(Number);
    if (values.some((value) => !Number.isFinite(value)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 100 || values[1] + values[3] > 100) {
      errors.push(issue(`layout.slots.${index}`, 'SLOT_BOUNDS_INVALID', 'El slot debe permanecer dentro del lienzo'));
    }
  });

  const textLayers = Array.isArray(layout.textLayers) ? layout.textLayers : [];
  if (!Array.isArray(layout.textLayers)) errors.push(issue('layout.textLayers', 'TEXT_LAYERS_INVALID', 'Las capas de texto deben ser un arreglo'));
  const textLayerIds = textLayers.map((layer: any) => String(layer?.id || ''));
  if (new Set(textLayerIds).size !== textLayerIds.length) errors.push(issue('layout.textLayers', 'TEXT_LAYER_DUPLICATE', 'Cada capa de texto debe aparecer una sola vez'));
  textLayers.forEach((layer: any, index: number) => {
    const path = `layout.textLayers.${index}`;
    if (!MIRROR_TEXT_LAYER_IDS.has(String(layer?.id || ''))) errors.push(issue(`${path}.id`, 'TEXT_LAYER_ID_INVALID', 'La capa de texto no esta soportada'));
    if (typeof layer?.text !== 'string' || layer.text.length > 160) errors.push(issue(`${path}.text`, 'TEXT_INVALID', 'El texto debe tener maximo 160 caracteres'));
    if (!finiteInRange(layer?.x, 0, 100) || !finiteInRange(layer?.y, 0, 100) || !finiteInRange(layer?.width, 1, 100) || Number(layer.x) + Number(layer.width) > 100) {
      errors.push(issue(path, 'TEXT_BOUNDS_INVALID', 'La capa de texto debe permanecer dentro del lienzo'));
    }
    if (!boundedInteger(layer?.size, 8, 54)) errors.push(issue(`${path}.size`, 'TEXT_SIZE_INVALID', 'El tamano debe estar entre 8 y 54'));
    if (!/^#[0-9a-f]{6}$/i.test(String(layer?.color || ''))) errors.push(issue(`${path}.color`, 'TEXT_COLOR_INVALID', 'El color debe usar formato hexadecimal'));
    if (!MIRROR_TEXT_FONTS.has(String(layer?.font || ''))) errors.push(issue(`${path}.font`, 'TEXT_FONT_INVALID', 'La fuente no esta soportada'));
  });

  const resources = config.resources || {};
  const animationIds = Array.isArray(resources.animationResourceIds) ? resources.animationResourceIds.map(String) : [];
  if (!Array.isArray(resources.animationResourceIds)) errors.push(issue('resources.animationResourceIds', 'ANIMATION_RESOURCES_INVALID', 'Las animaciones deben ser un arreglo'));
  if (new Set(animationIds).size !== animationIds.length) errors.push(issue('resources.animationResourceIds', 'ANIMATION_RESOURCE_DUPLICATE', 'Una animacion no puede repetirse'));
  if (textLayers.some((layer: any) => layer?.font === 'resource') && !resources.fontResourceId) {
    errors.push(issue('resources.fontResourceId', 'FONT_RESOURCE_REQUIRED', 'Selecciona una fuente del pool para las capas configuradas'));
  }

  const capture = config.capture || {};
  ['firstCountdownSeconds', 'nextCountdownSeconds', 'reviewSeconds'].forEach((key) => {
    if (!boundedInteger(capture?.[key], 1, 30)) errors.push(issue(`capture.${key}`, 'CAPTURE_TIME_INVALID', 'El tiempo debe estar entre 1 y 30 segundos'));
  });
  if (!MIRROR_LENSES.has(String(capture.lens || ''))) errors.push(issue('capture.lens', 'LENS_INVALID', 'La lente seleccionada no esta soportada'));
  if (!MIRROR_QUALITIES.has(String(capture.quality || ''))) errors.push(issue('capture.quality', 'QUALITY_INVALID', 'La calidad seleccionada no esta soportada'));
  ['flashEnabled', 'preserveOriginals', 'roamingMode'].forEach((key) => {
    if (!isBoolean(capture[key])) errors.push(issue(`capture.${key}`, 'BOOLEAN_REQUIRED', 'El valor debe ser booleano'));
  });

  const experience = config.experience || {};
  if (!MIRROR_EXPERIENCE_STYLES.has(String(experience.style || ''))) errors.push(issue('experience.style', 'EXPERIENCE_STYLE_INVALID', 'El estilo de experiencia no esta soportado'));
  if (!isBoolean(experience.virtualAssistantEnabled)) errors.push(issue('experience.virtualAssistantEnabled', 'BOOLEAN_REQUIRED', 'El asistente virtual debe ser booleano'));
  if (!experience.randomByStage || typeof experience.randomByStage !== 'object' || Array.isArray(experience.randomByStage)) {
    errors.push(issue('experience.randomByStage', 'RANDOM_STAGES_INVALID', 'Las etapas aleatorias deben ser un objeto'));
  } else {
    Object.entries(experience.randomByStage).forEach(([stage, enabled]) => {
      if (!MIRROR_ANIMATION_STAGE_SET.has(stage)) errors.push(issue(`experience.randomByStage.${stage}`, 'ANIMATION_STAGE_INVALID', 'La etapa de animacion no esta soportada'));
      if (!isBoolean(enabled)) errors.push(issue(`experience.randomByStage.${stage}`, 'BOOLEAN_REQUIRED', 'El valor debe ser booleano'));
    });
  }

  if (config.gif?.enabled) errors.push(issue('gif.enabled', 'CAPABILITY_UNAVAILABLE', 'La generacion GIF aun no esta disponible'));
  if (config.backgroundRemoval?.enabled) errors.push(issue('backgroundRemoval.enabled', 'CAPABILITY_UNAVAILABLE', 'La eliminacion de fondo aun no esta disponible'));
  const print = config.print || {};
  if (Number(print.paperWidthCm) !== 10 || Number(print.paperHeightCm) !== 14.8 || print.orientation !== 'portrait' || Number(print.dpi) !== 300 || Number(print.copies) !== 1 || print.fit !== 'contain') {
    errors.push(issue('print', 'PRINT_FORMAT_INVALID', 'La impresion debe usar 10 x 14.8 cm, retrato, 300 DPI, una copia y ajuste contain'));
  }
  if (config.print?.enabled || config.delivery?.print) errors.push(issue('print.enabled', 'CAPABILITY_UNAVAILABLE', 'La impresion fisica aun no esta disponible'));
  ['qr', 'share', 'download', 'print'].forEach((key) => {
    if (!isBoolean(config.delivery?.[key])) errors.push(issue(`delivery.${key}`, 'BOOLEAN_REQUIRED', 'El valor de entrega debe ser booleano'));
  });
  if (!boundedInteger(config.runtime?.autoResetSeconds, 5, 300)) errors.push(issue('runtime.autoResetSeconds', 'AUTO_RESET_INVALID', 'El reinicio debe estar entre 5 y 300 segundos'));
  if (!isBoolean(config.runtime?.operatorMenuEnabled)) errors.push(issue('runtime.operatorMenuEnabled', 'BOOLEAN_REQUIRED', 'El menu del operador debe ser booleano'));
  if (publish && !resources.templateResourceId && !resources.frameResourceId) {
    errors.push(issue('resources', 'FRAME_REQUIRED', 'Selecciona una plantilla o marco antes de publicar'));
  }
  return { valid: errors.length === 0, errors, warnings };
}

function resourceIds(config: any) {
  const resources = config?.resources || {};
  return [...new Set([
    resources.templateResourceId,
    resources.frameResourceId,
    resources.gifOverlayResourceId,
    resources.startScreenResourceId,
    resources.backgroundResourceId,
    resources.fontResourceId,
    ...(Array.isArray(resources.animationResourceIds) ? resources.animationResourceIds : []),
  ].filter(Boolean).map((value) => String(value)))];
}

function expectedResource(config: any, id: string) {
  const resources = config?.resources || {};
  if (String(resources.templateResourceId || '') === id) return { purpose: 'template', family: 'image' };
  if (String(resources.frameResourceId || '') === id) return { purpose: 'frame', family: 'image' };
  if (String(resources.gifOverlayResourceId || '') === id) return { purpose: 'gif_overlay', family: 'image' };
  if (String(resources.startScreenResourceId || '') === id) return { purpose: 'start_screen', family: 'visual' };
  if (String(resources.backgroundResourceId || '') === id) return { purpose: 'background', family: 'image' };
  if (String(resources.fontResourceId || '') === id) return { purpose: 'font', family: 'font' };
  return { purpose: 'animation', family: 'video' };
}

function mimeMatchesFamily(mimeType: unknown, family: string) {
  const mime = String(mimeType || '').toLowerCase();
  if (family === 'image') return mime.startsWith('image/');
  if (family === 'video') return mime.startsWith('video/');
  if (family === 'font') return mime.startsWith('font/') || ['application/font-sfnt', 'application/vnd.ms-opentype'].includes(mime);
  if (family === 'visual') return mime.startsWith('image/') || mime.startsWith('video/');
  return false;
}

async function getMirrorContext(eventIdValue: unknown, eventModeIdValue: unknown, requester: any, permission: string) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const eventModeId = parseEntityId(eventModeIdValue, 'ID de modo de evento');
  const [row] = await db.select({ event: eventsTable, eventMode: eventModesTable, mode: modesTable })
    .from(eventModesTable)
    .innerJoin(eventsTable, eq(eventModesTable.eventId, eventsTable.id))
    .innerJoin(modesTable, eq(eventModesTable.modeId, modesTable.id))
    .where(and(eq(eventModesTable.id, eventModeId), eq(eventsTable.id, eventId)))
    .limit(1);
  if (!row) throw new ServiceError(404, 'Modo de evento no encontrado');
  await assertAccountAccess(row.event.accountId, requester, permission === 'events.view' || permission === 'capture.operate' ? 'read' : 'write', permission);
  if (row.mode.slug !== 'espejo') throw new ServiceError(400, 'La configuracion solo aplica al modo espejo');
  if (!row.eventMode.isActive) throw new ServiceError(409, 'El modo espejo esta inactivo');
  return { ...row, eventId, eventModeId };
}

async function validateResources(context: any, config: any) {
  const errors: ValidationIssue[] = [];
  const ids = resourceIds(config);
  if (!ids.length) return { errors, manifest: [] };
  const parsedIds = ids.map((id) => parseEntityId(id, 'ID de recurso'));
  const rows = await db.select({ resource: eventResourcesTable, asset: libraryAssetsTable })
    .from(eventResourcesTable)
    .innerJoin(libraryAssetsTable, eq(eventResourcesTable.libraryAssetId, libraryAssetsTable.id))
    .where(inArray(eventResourcesTable.id, parsedIds));
  const rowById = new Map(rows.map((row) => [serializeId(row.resource.id), row]));
  for (const id of ids) {
    const row = rowById.get(id);
    if (!row || row.resource.eventId !== context.eventId) {
      errors.push(issue(`resources.${id}`, 'RESOURCE_NOT_AVAILABLE', 'El recurso no pertenece al evento'));
      continue;
    }
    if (row.resource.eventModeId && row.resource.eventModeId !== context.eventModeId) errors.push(issue(`resources.${id}`, 'RESOURCE_MODE_MISMATCH', 'El recurso pertenece a otro modo'));
    if (!row.resource.isActive || row.asset.status !== 'active') errors.push(issue(`resources.${id}`, 'RESOURCE_INACTIVE', 'El recurso esta inactivo'));
    if (row.asset.ownerType === 'account' && row.asset.ownerAccountId !== context.event.accountId) errors.push(issue(`resources.${id}`, 'RESOURCE_ACCOUNT_MISMATCH', 'El recurso pertenece a otra cuenta'));
    const expected = expectedResource(config, id);
    if (row.resource.purpose !== expected.purpose || row.asset.type !== expected.purpose) errors.push(issue(`resources.${id}`, 'RESOURCE_PURPOSE_MISMATCH', `El recurso debe tener proposito ${expected.purpose}`));
    if (!mimeMatchesFamily(row.asset.mimeType, expected.family)) errors.push(issue(`resources.${id}`, 'RESOURCE_MIME_MISMATCH', 'El formato del recurso no corresponde a su proposito'));
    if (expected.purpose === 'animation' && !MIRROR_ANIMATION_STAGE_SET.has(String(row.resource.placement || ''))) {
      errors.push(issue(`resources.${id}`, 'ANIMATION_PLACEMENT_INVALID', 'La animacion debe estar asociada a una etapa valida'));
    }
  }
  const manifest = await Promise.all(rows.map(async ({ resource, asset }) => ({
    eventResourceId: serializeId(resource.id), purpose: resource.purpose, placement: resource.placement,
    asset: await getLibraryAssetWithVariants(asset.id),
  })));
  return { errors, manifest };
}

async function fullValidation(context: any, config: any, publish = false) {
  const local = validateMirrorConfigContract(config, publish);
  const remote = await validateResources(context, config);
  if (publish) await assertSubscriptionIncludesModes(context.event.accountId, ['espejo']);
  const errors = [...local.errors, ...remote.errors];
  return { valid: errors.length === 0, errors, warnings: local.warnings, manifest: remote.manifest };
}

function mapConfig(row: any) {
  if (!row) return { eventModeId: null, schemaVersion: MIRROR_SCHEMA_VERSION, revision: 0, status: 'draft', config: defaultMirrorConfig(), publishedVersionId: null, updatedAt: null };
  return {
    id: serializeId(row.id), eventModeId: serializeId(row.eventModeId), schemaVersion: row.schemaVersion, revision: row.revision,
    status: row.publishedVersionId ? 'published' : 'draft', config: parseJson(row.config), publishedVersionId: serializeId(row.publishedVersionId), updatedAt: row.updatedAt,
  };
}

function mapVersion(row: any) {
  if (!row) return null;
  return { id: serializeId(row.id), eventModeId: serializeId(row.eventModeId), version: row.version, schemaVersion: row.schemaVersion, config: parseJson(row.config), publishedBy: serializeId(row.publishedBy), publishedAt: row.publishedAt };
}

function mapSession(row: any) {
  return { id: serializeId(row.id), eventModeId: serializeId(row.eventModeId), configVersionId: serializeId(row.configVersionId), clientSessionId: row.clientSessionId, deviceInstallationId: row.deviceInstallationId, startedBy: serializeId(row.startedBy), status: row.status, startedAt: row.startedAt, endedAt: row.endedAt, lastHeartbeatAt: row.lastHeartbeatAt, failureCode: row.failureCode, metadata: parseJson(row.metadata), updatedAt: row.updatedAt };
}

export async function getMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.view');
  const [row] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  return { ...mapConfig(row), eventModeId: serializeId(context.eventModeId) };
}

export async function saveMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.update');
  if (Number(input?.schemaVersion) !== MIRROR_SCHEMA_VERSION) throw new ServiceError(400, 'Version de configuracion no soportada');
  const validation = await fullValidation(context, input?.config, false);
  if (!validation.valid) throw new ServiceError(400, JSON.stringify({ code: 'CONFIG_INVALID', errors: validation.errors }));
  if (resourceIds(input?.config).length) await assertAccountAccess(context.event.accountId, requester, 'write', 'events.resources.manage');
  const expectedRevision = Number(input?.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ServiceError(400, 'expectedRevision invalida');
  const [current] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  const currentRevision = current?.revision || 0;
  if (currentRevision !== expectedRevision) throw new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision }));
  const now = new Date();
  if (!current) {
    await db.insert(eventModeConfigsTable).values({ eventModeId: context.eventModeId, schemaVersion: MIRROR_SCHEMA_VERSION, revision: 1, config: input.config, updatedBy: parseEntityId(requester.id), createdAt: now, updatedAt: now });
  } else {
    const result: any = await db.update(eventModeConfigsTable).set({ revision: current.revision + 1, config: input.config, updatedBy: parseEntityId(requester.id), updatedAt: now }).where(and(eq(eventModeConfigsTable.id, current.id), eq(eventModeConfigsTable.revision, expectedRevision)));
    if (!Number(result?.[0]?.affectedRows || 0)) throw new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision: current.revision }));
  }
  return getMirrorConfig(eventIdValue, eventModeIdValue, requester);
}

export async function validateMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.update');
  return fullValidation(context, input?.config, Boolean(input?.publish));
}

export async function publishMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.update');
  const [current] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  if (!current) throw new ServiceError(409, 'Guarda la configuracion antes de publicar');
  if (Number(input?.expectedRevision) !== current.revision) throw new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision: current.revision }));
  const config = parseJson(current.config);
  const validation = await fullValidation(context, config, true);
  if (!validation.valid) throw new ServiceError(400, JSON.stringify({ code: 'CONFIG_INVALID', errors: validation.errors }));
  const [lastVersion] = await db.select().from(eventModeConfigVersionsTable).where(eq(eventModeConfigVersionsTable.eventModeId, context.eventModeId)).orderBy(desc(eventModeConfigVersionsTable.version)).limit(1);
  const now = new Date();
  const versionId = await db.transaction(async (tx) => {
    const result = await tx.insert(eventModeConfigVersionsTable).values({ eventModeId: context.eventModeId, version: Number(lastVersion?.version || 0) + 1, schemaVersion: current.schemaVersion, config, publishedBy: parseEntityId(requester.id), publishedAt: now });
    const id = BigInt(result[0]?.insertId || 0);
    await tx.update(eventModeConfigsTable).set({ publishedVersionId: id, updatedAt: now }).where(eq(eventModeConfigsTable.id, current.id));
    return id;
  });
  const [version] = await db.select().from(eventModeConfigVersionsTable).where(eq(eventModeConfigVersionsTable.id, versionId)).limit(1);
  return { version: mapVersion(version), validation };
}

export async function getPublishedMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.view');
  const [configRow] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  if (!configRow?.publishedVersionId) throw new ServiceError(404, 'No hay una configuracion publicada');
  const [version] = await db.select().from(eventModeConfigVersionsTable).where(eq(eventModeConfigVersionsTable.id, configRow.publishedVersionId)).limit(1);
  const config = parseJson(version.config);
  const validation = await fullValidation(context, config, true);
  return { version: mapVersion(version), manifest: validation.manifest };
}

export async function startMirrorSession(eventIdValue: unknown, eventModeIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'capture.operate');
  const clientSessionId = String(input?.clientSessionId || '').trim();
  const deviceInstallationId = String(input?.deviceInstallationId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSessionId)) throw new ServiceError(400, 'clientSessionId debe ser UUID');
  if (!/^[A-Za-z0-9_.-]{3,120}$/.test(deviceInstallationId)) throw new ServiceError(400, 'deviceInstallationId invalido');
  const [existing] = await db.select().from(eventModeSessionsTable).where(eq(eventModeSessionsTable.clientSessionId, clientSessionId)).limit(1);
  if (existing) {
    if (existing.eventModeId !== context.eventModeId) throw new ServiceError(409, 'clientSessionId pertenece a otro modo');
    const published = await getPublishedMirrorConfig(eventIdValue, eventModeIdValue, requester);
    return { session: mapSession(existing), ...published };
  }
  const [configRow] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  if (!configRow?.publishedVersionId) throw new ServiceError(409, 'Publica la configuracion antes de lanzar');
  const published = await getPublishedMirrorConfig(eventIdValue, eventModeIdValue, requester);
  const now = new Date();
  const result = await db.insert(eventModeSessionsTable).values({ eventModeId: context.eventModeId, configVersionId: configRow.publishedVersionId, clientSessionId, deviceInstallationId, startedBy: parseEntityId(requester.id), status: 'preparing', startedAt: now, lastHeartbeatAt: now, metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : null, createdAt: now, updatedAt: now });
  const [session] = await db.select().from(eventModeSessionsTable).where(eq(eventModeSessionsTable.id, BigInt(result[0]?.insertId || 0))).limit(1);
  return { session: mapSession(session), ...published };
}

async function getSessionForContext(context: any, sessionIdValue: unknown) {
  const sessionId = parseEntityId(sessionIdValue, 'ID de sesion');
  const [session] = await db.select().from(eventModeSessionsTable).where(and(eq(eventModeSessionsTable.id, sessionId), eq(eventModeSessionsTable.eventModeId, context.eventModeId))).limit(1);
  if (!session) throw new ServiceError(404, 'Sesion no encontrada');
  return session;
}

export async function updateMirrorSession(eventIdValue: unknown, eventModeIdValue: unknown, sessionIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'capture.operate');
  const session = await getSessionForContext(context, sessionIdValue);
  if (['ended', 'failed'].includes(session.status)) throw new ServiceError(409, 'La sesion ya finalizo');
  const status = input?.status === undefined ? session.status : String(input.status);
  if (!['preparing', 'running'].includes(status) || (session.status === 'running' && status === 'preparing')) throw new ServiceError(409, 'Transicion de sesion invalida');
  const now = new Date();
  await db.update(eventModeSessionsTable).set({ status, lastHeartbeatAt: now, metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : session.metadata, updatedAt: now }).where(eq(eventModeSessionsTable.id, session.id));
  return mapSession({ ...session, status, lastHeartbeatAt: now, updatedAt: now });
}

export async function endMirrorSession(eventIdValue: unknown, eventModeIdValue: unknown, sessionIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'capture.operate');
  const session = await getSessionForContext(context, sessionIdValue);
  const status = String(input?.status || 'ended');
  if (!['ended', 'failed'].includes(status)) throw new ServiceError(400, 'Estado final invalido');
  if (['ended', 'failed'].includes(session.status)) return mapSession(session);
  const now = new Date();
  const failureCode = status === 'failed' ? String(input?.failureCode || 'UNKNOWN').trim().slice(0, 80) : null;
  await db.update(eventModeSessionsTable).set({ status, failureCode, endedAt: now, lastHeartbeatAt: now, metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : session.metadata, updatedAt: now }).where(eq(eventModeSessionsTable.id, session.id));
  return mapSession({ ...session, status, failureCode, endedAt: now, lastHeartbeatAt: now, updatedAt: now });
}
