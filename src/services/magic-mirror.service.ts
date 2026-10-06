import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
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
import { detachLegacyPhotoLayoutTemplate, MIRROR_CONFIGURABLE_ANIMATION_STAGES, validateMirrorConfigLocally as validateMirrorConfigContract } from '../domain/magic-mirror-config.ts';
import { assertEventAccess } from './event-access.service.ts';
import { getLibraryAssetWithVariants } from './library.service.ts';
import { assertSubscriptionIncludesModes } from './subscriptions.service.ts';

export const MIRROR_SCHEMA_VERSION = 1;

export const MIRROR_ANIMATION_STAGES = [
  'start',
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
const MIRROR_LAYER_MIN_VISIBLE_RATIO = 0.1;

export const defaultMirrorConfig = () => ({
  layout: {
    format: 'digital',
    output: { width: 1200, height: 1500 },
    shotCount: 1,
    order: [1],
    slots: [{ slotId: 'slot-1', photoNumber: 1, x: 7, y: 17, width: 86, height: 66 }],
    duplicateStrip: false,
    presetOrigin: null,
    backgroundLayers: [],
    frameLayers: [],
    textLayers: [],
    stickerLayers: [],
  },
  resources: {
    templateResourceId: null,
    layoutTemplateResourceId: null,
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
  experience: {
    style: 'video-vertical', virtualAssistantEnabled: true, randomByStage: {},
    animationEnabledByStage: { start: false, beforeCountdown: false, afterCapture: false, processing: false },
  },
  gif: { enabled: false, captureCount: 2, delayMs: 300, reverse: false, size: 'vertical-720' },
  backgroundRemoval: { enabled: false, mode: 'automatic', finalBackground: 'transparent', edgeSoftness: 'medium', keepShadow: true },
  print: { enabled: false, profileResourceId: null, paperWidthCm: 10, paperHeightCm: 14.8, orientation: 'portrait', dpi: 300, marginCm: 0, copies: 1, fit: 'contain', twoPerPage: false },
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

function hasValidOverflowBounds(values: number[], maximumSize = 100) {
  const [x, y, width, height] = values;
  if (values.some((value) => !Number.isFinite(value)) || width <= 0 || height <= 0 || width > maximumSize || height > maximumSize) return false;
  const visibleWidth = Math.max(0, Math.min(100, x + width) - Math.max(0, x));
  const visibleHeight = Math.max(0, Math.min(100, y + height) - Math.max(0, y));
  return (visibleWidth * visibleHeight) / (width * height) >= MIRROR_LAYER_MIN_VISIBLE_RATIO - 1e-9;
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
  if (slots.length < shotCount || slots.length > 16) errors.push(issue('layout.slots', 'SLOTS_COUNT_INVALID', 'Debe existir al menos un slot por toma y maximo 16 slots visuales'));
  const order = Array.isArray(layout.order) ? layout.order.map(Number) : [];
  const expectedOrder = Array.from({ length: shotCount }, (_, index) => index + 1);
  if (order.length !== shotCount || new Set(order).size !== shotCount || order.some((value) => !expectedOrder.includes(value))) {
    errors.push(issue('layout.order', 'SHOT_ORDER_INVALID', 'El orden debe incluir cada toma exactamente una vez'));
  }
  const slotPhotoNumbers = slots.map((slot: any) => Number(slot?.photoNumber));
  if (slotPhotoNumbers.some((value) => !expectedOrder.includes(value)) || expectedOrder.some((value) => !slotPhotoNumbers.includes(value))) {
    errors.push(issue('layout.slots', 'SLOT_PHOTO_NUMBER_INVALID', 'Cada toma debe estar representada en al menos un slot'));
  }
  const suppliedSlotIds = slots.map((slot: any) => slot?.slotId).filter((value: any) => value !== undefined && value !== null);
  if (suppliedSlotIds.some((value: any) => !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(String(value))) || new Set(suppliedSlotIds.map(String)).size !== suppliedSlotIds.length) errors.push(issue('layout.slots', 'SLOT_ID_INVALID', 'Cada slot visual debe tener un identificador unico valido'));
  slots.forEach((slot: any, index: number) => {
    const values = [slot?.x, slot?.y, slot?.width, slot?.height].map(Number);
    if (values.some((value) => !Number.isFinite(value)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 100 || values[1] + values[3] > 100) {
      errors.push(issue(`layout.slots.${index}`, 'SLOT_BOUNDS_INVALID', 'El slot debe permanecer dentro del lienzo'));
    }
    if (!finiteInRange(slot?.rotation ?? 0, -180, 180)) errors.push(issue(`layout.slots.${index}.rotation`, 'SLOT_ROTATION_INVALID', 'La rotacion debe estar entre -180 y 180 grados'));
  });

  const frameLayers = Array.isArray(layout.frameLayers) ? layout.frameLayers : [];
  if (layout.frameLayers !== undefined && !Array.isArray(layout.frameLayers)) errors.push(issue('layout.frameLayers', 'FRAME_LAYERS_INVALID', 'Los marcos deben ser un arreglo'));
  if (frameLayers.length > 10) errors.push(issue('layout.frameLayers', 'FRAME_LIMIT_EXCEEDED', 'Puedes agregar hasta 10 marcos'));
  const frameIds = frameLayers.map((layer: any) => String(layer?.id || ''));
  if (new Set(frameIds).size !== frameIds.length || frameIds.some((id: string) => !/^frame-[a-z0-9-]{1,80}$/i.test(id))) errors.push(issue('layout.frameLayers', 'FRAME_ID_INVALID', 'Cada marco debe tener un identificador unico'));
  const frameOrders = frameLayers.map((layer: any) => Number(layer?.order));
  if (new Set(frameOrders).size !== frameOrders.length || frameOrders.some((order: number) => !Number.isInteger(order) || order < 0 || order >= frameLayers.length)) errors.push(issue('layout.frameLayers', 'FRAME_ORDER_INVALID', 'El orden de los marcos no es valido'));
  frameLayers.forEach((layer: any, index: number) => {
    const path = `layout.frameLayers.${index}`;
    if (!/^\d+$/.test(String(layer?.resourceId || ''))) errors.push(issue(`${path}.resourceId`, 'FRAME_RESOURCE_INVALID', 'Cada marco debe usar un recurso valido'));
    const values = [layer?.x, layer?.y, layer?.width, layer?.height].map(Number);
    if (values.some((value) => !Number.isFinite(value)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 100 || values[1] + values[3] > 100) errors.push(issue(path, 'FRAME_BOUNDS_INVALID', 'El marco debe permanecer dentro del lienzo'));
    if (!finiteInRange(layer?.rotation ?? 0, -180, 180)) errors.push(issue(`${path}.rotation`, 'FRAME_ROTATION_INVALID', 'La rotacion debe estar entre -180 y 180 grados'));
  });

  const backgroundLayers = Array.isArray(layout.backgroundLayers) ? layout.backgroundLayers : [];
  if (layout.backgroundLayers !== undefined && !Array.isArray(layout.backgroundLayers)) errors.push(issue('layout.backgroundLayers', 'BACKGROUND_LAYERS_INVALID', 'Los fondos deben ser un arreglo'));
  if (backgroundLayers.length > 10) errors.push(issue('layout.backgroundLayers', 'BACKGROUND_LIMIT_EXCEEDED', 'Puedes agregar hasta 10 fondos'));
  const backgroundIds = backgroundLayers.map((layer: any) => String(layer?.id || ''));
  if (new Set(backgroundIds).size !== backgroundIds.length || backgroundIds.some((id: string) => !/^background-(resource|color)-[a-z0-9-]{1,80}$/i.test(id))) errors.push(issue('layout.backgroundLayers', 'BACKGROUND_ID_INVALID', 'Cada fondo debe tener un identificador unico'));
  const backgroundOrders = backgroundLayers.map((layer: any) => Number(layer?.order));
  if (new Set(backgroundOrders).size !== backgroundOrders.length || backgroundOrders.some((order: number) => !Number.isInteger(order) || order < 0 || order >= backgroundLayers.length)) errors.push(issue('layout.backgroundLayers', 'BACKGROUND_ORDER_INVALID', 'El orden de los fondos no es valido'));
  backgroundLayers.forEach((layer: any, index: number) => {
    const path = `layout.backgroundLayers.${index}`;
    if (!['resource', 'color'].includes(String(layer?.kind || ''))) errors.push(issue(`${path}.kind`, 'BACKGROUND_KIND_INVALID', 'El tipo de fondo no es valido'));
    if (layer?.kind === 'resource' && !/^\d+$/.test(String(layer?.resourceId || ''))) errors.push(issue(`${path}.resourceId`, 'BACKGROUND_RESOURCE_INVALID', 'El fondo debe usar un recurso valido'));
    if (layer?.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(String(layer?.color || ''))) errors.push(issue(`${path}.color`, 'BACKGROUND_COLOR_INVALID', 'El fondo debe usar un color hexadecimal'));
    const values = [layer?.x, layer?.y, layer?.width, layer?.height].map(Number);
    const maximumSize = layer?.kind === 'color' ? 200 : 100;
    if (!hasValidOverflowBounds(values, maximumSize)) errors.push(issue(path, 'BACKGROUND_BOUNDS_INVALID', 'El fondo debe conservar al menos 10% visible y respetar su tamano maximo'));
    if (!finiteInRange(layer?.rotation ?? 0, -180, 180)) errors.push(issue(`${path}.rotation`, 'BACKGROUND_ROTATION_INVALID', 'La rotacion debe estar entre -180 y 180 grados'));
  });


  const textLayers = Array.isArray(layout.textLayers) ? layout.textLayers : [];
  if (!Array.isArray(layout.textLayers)) errors.push(issue('layout.textLayers', 'TEXT_LAYERS_INVALID', 'Las capas de texto deben ser un arreglo'));
  if (textLayers.length > 10) errors.push(issue('layout.textLayers', 'TEXT_LAYER_LIMIT_EXCEEDED', 'Puedes agregar hasta 10 textos'));
  const textLayerIds = textLayers.map((layer: any) => String(layer?.id || ''));
  if (new Set(textLayerIds).size !== textLayerIds.length) errors.push(issue('layout.textLayers', 'TEXT_LAYER_DUPLICATE', 'Cada capa de texto debe aparecer una sola vez'));
  const textLayerOrders = textLayers.map((layer: any, index: number) => layer?.order ?? index);
  if (new Set(textLayerOrders).size !== textLayerOrders.length || textLayerOrders.some((order: any) => !boundedInteger(order, 0, Math.max(0, textLayers.length - 1)))) errors.push(issue('layout.textLayers', 'TEXT_LAYER_ORDER_INVALID', 'El orden de los textos no es valido'));
  textLayers.forEach((layer: any, index: number) => {
    const path = `layout.textLayers.${index}`;
    if (!MIRROR_TEXT_LAYER_IDS.has(String(layer?.id || ''))) errors.push(issue(`${path}.id`, 'TEXT_LAYER_ID_INVALID', 'La capa de texto no esta soportada'));
    if (typeof layer?.text !== 'string' || layer.text.length > 160) errors.push(issue(`${path}.text`, 'TEXT_INVALID', 'El texto debe tener maximo 160 caracteres'));
    if (!finiteInRange(layer?.x, 0, 100) || !finiteInRange(layer?.y, 0, 100) || !finiteInRange(layer?.width, 1, 100) || Number(layer.x) + Number(layer.width) > 100) {
      errors.push(issue(path, 'TEXT_BOUNDS_INVALID', 'La capa de texto debe permanecer dentro del lienzo'));
    }
    if (!boundedInteger(layer?.size, 8, 54)) errors.push(issue(`${path}.size`, 'TEXT_SIZE_INVALID', 'El tamano debe estar entre 8 y 54'));
    if (!finiteInRange(layer?.rotation ?? 0, -180, 180)) errors.push(issue(`${path}.rotation`, 'TEXT_ROTATION_INVALID', 'La rotacion debe estar entre -180 y 180 grados'));
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
    if (!boundedInteger(capture?.[key], 0, 20)) errors.push(issue(`capture.${key}`, 'CAPTURE_TIME_INVALID', 'El tiempo debe estar entre 0 y 20 segundos'));
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
  const configurableAnimationStages = new Set<string>(MIRROR_CONFIGURABLE_ANIMATION_STAGES);
  if (experience.animationEnabledByStage !== undefined && (typeof experience.animationEnabledByStage !== 'object' || Array.isArray(experience.animationEnabledByStage))) {
    errors.push(issue('experience.animationEnabledByStage', 'ANIMATION_ENABLED_STAGES_INVALID', 'Las etapas activas deben ser un objeto'));
  } else Object.entries(experience.animationEnabledByStage || {}).forEach(([stage, enabled]) => {
    if (!configurableAnimationStages.has(stage)) errors.push(issue(`experience.animationEnabledByStage.${stage}`, 'ANIMATION_STAGE_INVALID', 'La etapa de animacion no es configurable'));
    if (!isBoolean(enabled)) errors.push(issue(`experience.animationEnabledByStage.${stage}`, 'BOOLEAN_REQUIRED', 'El valor debe ser booleano'));
  });

  if (config.gif?.enabled) errors.push(issue('gif.enabled', 'CAPABILITY_UNAVAILABLE', 'La generacion GIF aun no esta disponible'));
  if (config.backgroundRemoval?.enabled) errors.push(issue('backgroundRemoval.enabled', 'CAPABILITY_UNAVAILABLE', 'La eliminacion de fondo aun no esta disponible'));
  const print = config.print || {};
  if (typeof print.enabled !== 'boolean') errors.push(issue('print.enabled', 'BOOLEAN_REQUIRED', 'El estado de impresion debe ser booleano'));
  if (print.profileResourceId !== null && print.profileResourceId !== undefined && !/^\d+$/.test(String(print.profileResourceId))) errors.push(issue('print.profileResourceId', 'PRINT_PROFILE_INVALID', 'El perfil de impresion no es valido'));
  if (print.enabled && !print.profileResourceId) errors.push(issue('print.profileResourceId', 'PRINT_PROFILE_REQUIRED', 'Selecciona un perfil de impresion'));
  if (!finiteInRange(print.paperWidthCm, 2, 200) || !finiteInRange(print.paperHeightCm, 2, 200)) errors.push(issue('print.paper', 'PRINT_PAPER_INVALID', 'Las medidas de papel no son validas'));
  if (!['portrait', 'landscape'].includes(String(print.orientation))) errors.push(issue('print.orientation', 'PRINT_ORIENTATION_INVALID', 'La orientacion no es valida'));
  if (!boundedInteger(print.dpi, 72, 1200)) errors.push(issue('print.dpi', 'PRINT_DPI_INVALID', 'La resolucion debe estar entre 72 y 1200 DPI'));
  if (!finiteInRange(print.marginCm, 0, Math.min(Number(print.paperWidthCm), Number(print.paperHeightCm)) / 3)) errors.push(issue('print.marginCm', 'PRINT_MARGIN_INVALID', 'El margen de impresion no es valido'));
  if (!boundedInteger(print.copies, 1, 100)) errors.push(issue('print.copies', 'PRINT_COPIES_INVALID', 'Las copias deben estar entre 1 y 100'));
  if (!['contain', 'cover'].includes(String(print.fit))) errors.push(issue('print.fit', 'PRINT_FIT_INVALID', 'El ajuste de impresion no es valido'));
  if (typeof print.twoPerPage !== 'boolean') errors.push(issue('print.twoPerPage', 'BOOLEAN_REQUIRED', 'La opcion dos por pagina debe ser booleana'));
  if (Boolean(config.delivery?.print) !== Boolean(print.enabled)) errors.push(issue('delivery.print', 'PRINT_DELIVERY_MISMATCH', 'La entrega impresa debe coincidir con el estado de impresion'));
  ['qr', 'share', 'download', 'print'].forEach((key) => {
    if (!isBoolean(config.delivery?.[key])) errors.push(issue(`delivery.${key}`, 'BOOLEAN_REQUIRED', 'El valor de entrega debe ser booleano'));
  });
  // Legacy autoResetSeconds is not a publication requirement.
  if (!isBoolean(config.runtime?.operatorMenuEnabled)) errors.push(issue('runtime.operatorMenuEnabled', 'BOOLEAN_REQUIRED', 'El menu del operador debe ser booleano'));
  return { valid: errors.length === 0, errors, warnings };
}

function resourceIds(config: any) {
  const resources = config?.resources || {};
  const frameIds = Array.isArray(config?.layout?.frameLayers) ? config.layout.frameLayers.map((layer: any) => layer?.resourceId) : [];
  const backgroundIds = Array.isArray(config?.layout?.backgroundLayers) ? config.layout.backgroundLayers.filter((layer: any) => layer?.kind === 'resource').map((layer: any) => layer?.resourceId) : [];
  const stickerIds = Array.isArray(config?.layout?.stickerLayers) ? config.layout.stickerLayers.map((layer: any) => layer?.resourceId) : [];
  const layerFontIds = Array.isArray(config?.layout?.textLayers) ? config.layout.textLayers.map((layer: any) => layer?.fontResourceId) : [];
  return [...new Set([
    resources.templateResourceId,
    resources.frameResourceId,
    resources.gifOverlayResourceId,
    resources.startScreenResourceId,
    resources.backgroundResourceId,
    resources.fontResourceId,
    config?.print?.profileResourceId,
    ...frameIds,
    ...backgroundIds,
    ...stickerIds,
    ...layerFontIds,
    ...(Array.isArray(resources.animationResourceIds) ? resources.animationResourceIds : []),
  ].filter(Boolean).map((value) => String(value)))];
}

function expectedResource(config: any, id: string) {
  const resources = config?.resources || {};
  const frameLayers = Array.isArray(config?.layout?.frameLayers) ? config.layout.frameLayers : [];
  const backgroundLayers = Array.isArray(config?.layout?.backgroundLayers) ? config.layout.backgroundLayers : [];
  const stickerLayers = Array.isArray(config?.layout?.stickerLayers) ? config.layout.stickerLayers : [];
  const textLayers = Array.isArray(config?.layout?.textLayers) ? config.layout.textLayers : [];
  if (String(resources.templateResourceId || '') === id) return { purpose: 'template', family: 'image' };
  if (String(resources.frameResourceId || '') === id) return { purpose: 'frame', family: 'image' };
  if (frameLayers.some((layer: any) => String(layer?.resourceId || '') === id)) return { purpose: 'frame', family: 'image' };
  if (backgroundLayers.some((layer: any) => layer?.kind === 'resource' && String(layer?.resourceId || '') === id)) return { purpose: 'background', family: 'image' };
  if (String(resources.gifOverlayResourceId || '') === id) return { purpose: 'gif_overlay', family: 'image' };
  if (String(resources.startScreenResourceId || '') === id) return { purpose: 'start_screen', family: 'visual' };
  if (String(resources.backgroundResourceId || '') === id) return { purpose: 'background', family: 'image' };
  if (String(resources.fontResourceId || '') === id) return { purpose: 'font', family: 'font' };
  if (String(config?.print?.profileResourceId || '') === id) return { purpose: 'print_profile', family: 'print_profile' };
  if (stickerLayers.some((layer: any) => String(layer?.resourceId || '') === id)) return { purpose: 'sticker', family: 'image', motion: 'static' };
  if (textLayers.some((layer: any) => String(layer?.fontResourceId || '') === id)) return { purpose: 'font', family: 'font' };
  return { purpose: 'animation', family: 'video' };
}

function mimeMatchesFamily(mimeType: unknown, family: string) {
  const mime = String(mimeType || '').toLowerCase();
  if (family === 'image') return mime.startsWith('image/');
  if (family === 'video') return mime.startsWith('video/');
  if (family === 'font') return mime.startsWith('font/') || ['application/font-sfnt', 'application/vnd.ms-opentype'].includes(mime);
  if (family === 'template') return mime === 'application/vnd.kaptura.photo-layout+json';
  if (family === 'print_profile') return mime === 'application/vnd.kaptura.print-profile+json';
  if (family === 'visual') return mime.startsWith('image/') || mime.startsWith('video/');
  return false;
}

function assetMatchesExpectedPurpose(asset: any, expectedPurpose: string) {
  if (asset.type === expectedPurpose) return true;
  return expectedPurpose === 'gif_overlay' && asset.type === 'sticker' && asset.motionType === 'animated';
}

export async function getMirrorContext(eventIdValue: unknown, eventModeIdValue: unknown, requester: any, permission: string) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const eventModeId = parseEntityId(eventModeIdValue, 'ID de modo de evento');
  const [row] = await db.select({ event: eventsTable, eventMode: eventModesTable, mode: modesTable })
    .from(eventModesTable)
    .innerJoin(eventsTable, eq(eventModesTable.eventId, eventsTable.id))
    .innerJoin(modesTable, eq(eventModesTable.modeId, modesTable.id))
    .where(and(eq(eventModesTable.id, eventModeId), eq(eventsTable.id, eventId)))
    .limit(1);
  if (!row) throw new ServiceError(404, 'Modo de evento no encontrado');
  await assertEventAccess(row.event.id, requester, permission === 'events.view' || permission === 'capture.operate' ? 'read' : 'write', permission);
  if (row.mode.slug !== 'espejo') throw new ServiceError(400, 'La configuracion solo aplica al modo espejo');
  if (!row.eventMode.isActive) throw new ServiceError(409, 'El modo espejo esta inactivo');
  if (permission === 'capture.operate' && row.event.status !== 'active') throw new ServiceError(409, JSON.stringify({ code: 'EVENT_NOT_ACTIVE', message: 'Activa el evento antes de lanzarlo' }));
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
    const purposeMatches = row.resource.purpose === expected.purpose
      || (expected.purpose === 'gif_overlay' && row.resource.purpose === 'sticker');
    if (!purposeMatches || !assetMatchesExpectedPurpose(row.asset, expected.purpose)) errors.push(issue(`resources.${id}`, 'RESOURCE_PURPOSE_MISMATCH', `El recurso debe tener proposito ${expected.purpose}`));
    if (expected.motion && row.asset.motionType !== expected.motion) errors.push(issue(`resources.${id}`, 'RESOURCE_MOTION_MISMATCH', 'El sticker debe ser sin movimiento'));
    if (!mimeMatchesFamily(row.asset.mimeType, expected.family)) errors.push(issue(`resources.${id}`, 'RESOURCE_MIME_MISMATCH', 'El formato del recurso no corresponde a su proposito'));
    if (expected.purpose === 'animation' && !MIRROR_ANIMATION_STAGE_SET.has(String(row.resource.placement || ''))) {
      errors.push(issue(`resources.${id}`, 'ANIMATION_PLACEMENT_INVALID', 'La animacion debe estar asociada a una etapa valida'));
    }
  }
  const configuredAnimationIds = new Set(
    (Array.isArray(config?.resources?.animationResourceIds) ? config.resources.animationResourceIds : []).map(String),
  );
  const assignedAnimationStages = new Set(
    rows
      .filter(({ resource }) => configuredAnimationIds.has(serializeId(resource.id)) && resource.purpose === 'animation')
      .map(({ resource }) => String(resource.placement || '')),
  );
  for (const stage of MIRROR_CONFIGURABLE_ANIMATION_STAGES) {
    if (config?.experience?.animationEnabledByStage?.[stage] === true && !assignedAnimationStages.has(stage)) {
      errors.push(issue(
        `experience.animationEnabledByStage.${stage}`,
        'ANIMATION_STAGE_RESOURCE_REQUIRED',
        'Selecciona una animacion para la etapa activa',
      ));
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

function mapConfig(row: any, publishedConfig?: any) {
  if (!row) return { eventModeId: null, schemaVersion: MIRROR_SCHEMA_VERSION, revision: 0, status: 'draft', config: defaultMirrorConfig(), publishedVersionId: null, updatedAt: null };
  return {
    id: serializeId(row.id), eventModeId: serializeId(row.eventModeId), schemaVersion: row.schemaVersion, revision: row.revision,
    status: row.publishedVersionId && publishedConfig && isDeepStrictEqual(parseJson(row.config), publishedConfig) ? 'published' : 'draft', config: parseJson(row.config), publishedVersionId: serializeId(row.publishedVersionId), updatedAt: row.updatedAt,
  };
}

function mapVersion(row: any) {
  if (!row) return null;
  return { id: serializeId(row.id), eventModeId: serializeId(row.eventModeId), version: row.version, schemaVersion: row.schemaVersion, config: parseJson(row.config), publishedBy: serializeId(row.publishedBy), publishedAt: row.publishedAt };
}

export function mapSession(row: any) {
  return { id: serializeId(row.id), eventModeId: serializeId(row.eventModeId), configVersionId: serializeId(row.configVersionId), clientSessionId: row.clientSessionId, deviceInstallationId: row.deviceInstallationId, startedBy: serializeId(row.startedBy), status: row.status, startedAt: row.startedAt, endedAt: row.endedAt, lastHeartbeatAt: row.lastHeartbeatAt, failureCode: row.failureCode, metadata: parseJson(row.metadata), updatedAt: row.updatedAt };
}

export async function getMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.view');
  const [row] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  const [published] = row?.publishedVersionId
    ? await db.select().from(eventModeConfigVersionsTable).where(and(eq(eventModeConfigVersionsTable.id, row.publishedVersionId), eq(eventModeConfigVersionsTable.eventModeId, context.eventModeId))).limit(1)
    : [];
  return { ...mapConfig(row, published ? parseJson(published.config) : undefined), publishedVersion: published?.version ?? null, eventModeId: serializeId(context.eventModeId) };
}

export async function saveMirrorConfig(eventIdValue: unknown, eventModeIdValue: unknown, input: any, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.update');
  if (Number(input?.schemaVersion) !== MIRROR_SCHEMA_VERSION) throw new ServiceError(400, 'Version de configuracion no soportada');
  const legacyTemplateResourceId = input?.config?.resources?.layoutTemplateResourceId;
  const canonicalConfig = detachLegacyPhotoLayoutTemplate(input?.config);
  const validation = await fullValidation(context, canonicalConfig, false);
  if (!validation.valid) throw new ServiceError(400, JSON.stringify({ code: 'CONFIG_INVALID', errors: validation.errors }));
  if (resourceIds(canonicalConfig).length) await assertEventAccess(context.eventId, requester, 'write', 'events.resources.manage');
  const expectedRevision = Number(input?.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ServiceError(400, 'expectedRevision invalida');
  const [current] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  const currentRevision = current?.revision || 0;
  if (currentRevision !== expectedRevision) throw new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision }));
  const now = new Date();
  await db.transaction(async (tx) => {
    if (!current) {
      await tx.insert(eventModeConfigsTable).values({ eventModeId: context.eventModeId, schemaVersion: MIRROR_SCHEMA_VERSION, revision: 1, config: canonicalConfig, updatedBy: parseEntityId(requester.id), createdAt: now, updatedAt: now });
    } else {
      const result: any = await tx.update(eventModeConfigsTable).set({ revision: current.revision + 1, config: canonicalConfig, updatedBy: parseEntityId(requester.id), updatedAt: now }).where(and(eq(eventModeConfigsTable.id, current.id), eq(eventModeConfigsTable.revision, expectedRevision)));
      if (!Number(result?.[0]?.affectedRows || 0)) throw new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision: current.revision }));
    }
    if (/^\d+$/.test(String(legacyTemplateResourceId || ''))) {
      await tx.update(eventResourcesTable).set({ isActive: false, updatedAt: now }).where(and(
        eq(eventResourcesTable.id, parseEntityId(legacyTemplateResourceId, 'ID de recurso')),
        eq(eventResourcesTable.eventId, context.eventId),
        eq(eventResourcesTable.eventModeId, context.eventModeId),
        eq(eventResourcesTable.purpose, 'template'),
      ));
    }
  });
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
  const now = new Date();
  const versionId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM event_modes WHERE id = ${context.eventModeId} FOR UPDATE`);
    const [lockedDraft] = await tx.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.id, current.id)).limit(1);
    if (lockedDraft?.revision !== current.revision) throw new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision: lockedDraft?.revision }));
    const [lastVersion] = await tx.select().from(eventModeConfigVersionsTable).where(eq(eventModeConfigVersionsTable.eventModeId, context.eventModeId)).orderBy(desc(eventModeConfigVersionsTable.version)).limit(1);
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
  await assertSubscriptionIncludesModes(context.event.accountId, ['espejo']);
  const clientSessionId = String(input?.clientSessionId || '').trim();
  const deviceInstallationId = String(input?.deviceInstallationId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSessionId)) throw new ServiceError(400, 'clientSessionId debe ser UUID');
  if (!/^[A-Za-z0-9_.-]{3,120}$/.test(deviceInstallationId)) throw new ServiceError(400, 'deviceInstallationId invalido');
  const [configRow] = await db.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
  if (!configRow?.publishedVersionId) throw new ServiceError(409, 'Publica la configuracion antes de lanzar');
  const published = await getPublishedMirrorConfig(eventIdValue, eventModeIdValue, requester);
  const expectedVersion = input?.expectedPublishedVersionId == null ? null : String(parseEntityId(input.expectedPublishedVersionId, 'Version publicada'));
  const now = new Date();
  const session = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM event_modes WHERE id = ${context.eventModeId} FOR UPDATE`);
    const [lockedConfig] = await tx.select().from(eventModeConfigsTable).where(eq(eventModeConfigsTable.eventModeId, context.eventModeId)).limit(1);
    if (String(lockedConfig?.publishedVersionId) !== String(published.version.id) || (expectedVersion && expectedVersion !== String(lockedConfig?.publishedVersionId))) {
      throw new ServiceError(409, JSON.stringify({ code: 'MIRROR_PUBLISHED_VERSION_CHANGED', message: 'La publicacion cambio. Vuelve a iniciar el lanzamiento.' }));
    }
    const [existing] = await tx.select().from(eventModeSessionsTable).where(eq(eventModeSessionsTable.clientSessionId, clientSessionId)).limit(1);
    if (existing) {
      if (existing.eventModeId !== context.eventModeId) throw new ServiceError(409, 'clientSessionId pertenece a otro modo');
      if (expectedVersion && expectedVersion !== String(existing.configVersionId)) throw new ServiceError(409, JSON.stringify({ code: 'MIRROR_PUBLISHED_VERSION_CHANGED', message: 'La publicacion cambio. Vuelve a iniciar el lanzamiento.' }));
      return existing;
    }
    const [active] = await tx.select().from(eventModeSessionsTable).where(and(
      eq(eventModeSessionsTable.eventModeId, context.eventModeId),
      inArray(eventModeSessionsTable.status, ['preparing', 'running']),
    )).orderBy(desc(eventModeSessionsTable.id)).limit(1);
    if (active) throw new ServiceError(409, JSON.stringify({
      code: 'MIRROR_SESSION_ALREADY_ACTIVE',
      message: 'Este modo ya esta lanzado en otro dispositivo',
      session: mapSession(active),
    }));
    const result = await tx.insert(eventModeSessionsTable).values({ eventModeId: context.eventModeId, configVersionId: configRow.publishedVersionId, clientSessionId, deviceInstallationId, startedBy: parseEntityId(requester.id), status: 'preparing', startedAt: now, lastHeartbeatAt: now, metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : null, createdAt: now, updatedAt: now });
    const [created] = await tx.select().from(eventModeSessionsTable).where(eq(eventModeSessionsTable.id, BigInt(result[0]?.insertId || 0))).limit(1);
    return created;
  });
  // Idempotent requests may find a session pinned to an older publication.
  // Never return that session alongside the latest (different) configuration.
  if (String(session.configVersionId) !== String(published.version.id)) return getMirrorSessionPackage(eventIdValue, eventModeIdValue, serializeId(session.id), requester);
  return { session: mapSession(session), ...published };
}

export async function getActiveMirrorSession(eventIdValue: unknown, eventModeIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'capture.operate');
  const [session] = await db.select().from(eventModeSessionsTable).where(and(
    eq(eventModeSessionsTable.eventModeId, context.eventModeId),
    inArray(eventModeSessionsTable.status, ['preparing', 'running']),
  )).orderBy(desc(eventModeSessionsTable.id)).limit(1);
  if (!session) return { session: null, version: null, manifest: [] };
  const [version] = await db.select().from(eventModeConfigVersionsTable).where(eq(eventModeConfigVersionsTable.id, session.configVersionId)).limit(1);
  if (!version) throw new ServiceError(409, 'La publicacion de la sesion ya no esta disponible');
  const validation = await fullValidation(context, parseJson(version.config), false);
  return { session: mapSession(session), version: mapVersion(version), manifest: validation.manifest };
}

export async function getMirrorSessionPackage(eventIdValue: unknown, eventModeIdValue: unknown, sessionIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'capture.operate');
  const session = await getSessionForContext(context, sessionIdValue);
  const [version] = await db.select().from(eventModeConfigVersionsTable).where(eq(eventModeConfigVersionsTable.id, session.configVersionId)).limit(1);
  if (!version) throw new ServiceError(409, 'La publicacion de la sesion ya no esta disponible');
  const validation = await fullValidation(context, parseJson(version.config), false);
  return { session: mapSession(session), version: mapVersion(version), manifest: validation.manifest };
}

export async function forceEndMirrorSession(eventIdValue: unknown, eventModeIdValue: unknown, sessionIdValue: unknown, requester: any) {
  const context = await getMirrorContext(eventIdValue, eventModeIdValue, requester, 'events.update');
  const session = await getSessionForContext(context, sessionIdValue);
  if (['ended', 'failed'].includes(session.status)) return mapSession(session);
  const now = new Date();
  await db.update(eventModeSessionsTable).set({ status: 'failed', failureCode: 'FORCED_TAKEOVER', endedAt: now, lastHeartbeatAt: now, updatedAt: now }).where(eq(eventModeSessionsTable.id, session.id));
  return mapSession({ ...session, status: 'failed', failureCode: 'FORCED_TAKEOVER', endedAt: now, lastHeartbeatAt: now, updatedAt: now });
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
