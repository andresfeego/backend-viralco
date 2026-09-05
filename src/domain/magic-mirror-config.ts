export const MIRROR_SCHEMA_VERSION = 1;

export const MIRROR_ANIMATION_STAGES = [
  'beforeCountdown', 'afterCapture', 'countdown', 'pickMusic', 'beforeSignature',
  'processing', 'afterProcessing', 'sessionEnd',
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

const TEXT_LAYER_IDS = new Set(['script', 'name', 'event', 'date']);
const TEXT_FONTS = new Set(['arial', 'georgia', 'impact', 'verdana', 'courier', 'resource']);
const LENSES = new Set(['normal', 'wide', 'ultra-wide']);
const QUALITIES = new Set(['medium', 'high', 'superior']);
const EXPERIENCE_STYLES = new Set(['video-vertical', 'minimal', 'party']);
const ANIMATION_STAGE_SET = new Set<string>(MIRROR_ANIMATION_STAGES);
const MIRROR_LAYER_MIN_VISIBLE_RATIO = 0.1;

export type MirrorValidationIssue = { path: string; code: string; message: string };

export const defaultMirrorConfig = () => ({
  layout: {
    format: 'digital', output: { width: 1200, height: 1500 }, shotCount: 1, order: [1],
    slots: [{ slotId: 'slot-1', photoNumber: 1, x: 7, y: 17, width: 86, height: 66 }], duplicateStrip: false, backgroundLayers: [], frameLayers: [], textLayers: [], stickerLayers: [],
  },
  resources: {
    templateResourceId: null, layoutTemplateResourceId: null, frameResourceId: null, gifOverlayResourceId: null,
    startScreenResourceId: null, backgroundResourceId: null, fontResourceId: null, animationResourceIds: [],
  },
  capture: {
    firstCountdownSeconds: 5, nextCountdownSeconds: 5, reviewSeconds: 5,
    flashEnabled: true, lens: 'wide', quality: 'high', preserveOriginals: true, roamingMode: false,
  },
  experience: { style: 'video-vertical', virtualAssistantEnabled: true, randomByStage: {} },
  gif: { enabled: false, captureCount: 2, delayMs: 300, reverse: false, size: 'vertical-720' },
  backgroundRemoval: { enabled: false, mode: 'automatic', finalBackground: 'transparent', edgeSoftness: 'medium', keepShadow: true },
  print: { enabled: false, paperWidthCm: 10, paperHeightCm: 14.8, orientation: 'portrait', dpi: 300, marginCm: 0, copies: 1, fit: 'contain', twoPerPage: false },
  delivery: { qr: true, share: true, download: true, print: false },
  runtime: { autoResetSeconds: 15, operatorMenuEnabled: true },
});

function issue(path: string, code: string, message: string): MirrorValidationIssue {
  return { path, code, message };
}

function boundedInteger(value: unknown, min: number, max: number) {
  return Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

function hasValidOverflowBounds(values: number[], maximumSize = 100) {
  const [x, y, width, height] = values;
  if (values.some((value) => !Number.isFinite(value)) || width <= 0 || height <= 0 || width > maximumSize || height > maximumSize) return false;
  const visibleWidth = Math.max(0, Math.min(100, x + width) - Math.max(0, x));
  const visibleHeight = Math.max(0, Math.min(100, y + height) - Math.max(0, y));
  return (visibleWidth * visibleHeight) / (width * height) >= MIRROR_LAYER_MIN_VISIBLE_RATIO - 1e-9;
}

function finiteInRange(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

export function validateMirrorConfigLocally(config: any, publish = false) {
  const errors: MirrorValidationIssue[] = [];
  const warnings: MirrorValidationIssue[] = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [issue('config', 'CONFIG_INVALID', 'La configuracion debe ser un objeto')], warnings };
  }

  const layout = config.layout || {};
  const shotCount = Number(layout.shotCount);
  const format = String(layout.format || '');
  const formatSpec = MIRROR_FORMATS[format as keyof typeof MIRROR_FORMATS];
  if (!formatSpec) errors.push(issue('layout.format', 'FORMAT_INVALID', 'Selecciona un formato de Espejo valido'));
  else {
    if (!boundedInteger(shotCount, formatSpec.minShots, formatSpec.maxShots)) errors.push(issue('layout.shotCount', 'SHOT_COUNT_INVALID', `La cantidad de tomas para ${format} debe estar entre ${formatSpec.minShots} y ${formatSpec.maxShots}`));
    if (Number(layout.output?.width) !== formatSpec.width || Number(layout.output?.height) !== formatSpec.height) errors.push(issue('layout.output', 'OUTPUT_FORMAT_MISMATCH', `El formato ${format} requiere salida ${formatSpec.width} x ${formatSpec.height}`));
    if (layout.duplicateStrip === true && !formatSpec.duplicateStrip) errors.push(issue('layout.duplicateStrip', 'DUPLICATE_STRIP_UNAVAILABLE', 'La tira duplicada no esta disponible para este formato'));
  }
  if (typeof layout.duplicateStrip !== 'boolean') errors.push(issue('layout.duplicateStrip', 'BOOLEAN_REQUIRED', 'La tira duplicada debe ser booleana'));

  const slots = Array.isArray(layout.slots) ? layout.slots : [];
  if (slots.length < shotCount || slots.length > 16) errors.push(issue('layout.slots', 'SLOTS_COUNT_INVALID', 'Debe existir al menos un slot por toma y maximo 16 slots visuales'));
  const order = Array.isArray(layout.order) ? layout.order.map(Number) : [];
  const expectedOrder = Array.from({ length: shotCount }, (_, index) => index + 1);
  if (order.length !== shotCount || new Set(order).size !== shotCount || order.some((value) => !expectedOrder.includes(value))) errors.push(issue('layout.order', 'SHOT_ORDER_INVALID', 'El orden debe incluir cada toma exactamente una vez'));
  const slotPhotoNumbers = slots.map((slot: any) => Number(slot?.photoNumber));
  if (slotPhotoNumbers.some((value) => !expectedOrder.includes(value)) || expectedOrder.some((value) => !slotPhotoNumbers.includes(value))) errors.push(issue('layout.slots', 'SLOT_PHOTO_NUMBER_INVALID', 'Cada toma debe estar representada en al menos un slot'));
  const suppliedSlotIds = slots.map((slot: any) => slot?.slotId).filter((value: any) => value !== undefined && value !== null);
  if (suppliedSlotIds.some((value: any) => !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(String(value))) || new Set(suppliedSlotIds.map(String)).size !== suppliedSlotIds.length) errors.push(issue('layout.slots', 'SLOT_ID_INVALID', 'Cada slot visual debe tener un identificador unico valido'));
  slots.forEach((slot: any, index: number) => {
    const values = [slot?.x, slot?.y, slot?.width, slot?.height].map(Number);
    if (values.some((value) => !Number.isFinite(value)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 100 || values[1] + values[3] > 100) errors.push(issue(`layout.slots.${index}`, 'SLOT_BOUNDS_INVALID', 'El slot debe permanecer dentro del lienzo'));
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
  const textLayerIds = textLayers.map((layer: any) => String(layer?.id || ''));
  if (new Set(textLayerIds).size !== textLayerIds.length) errors.push(issue('layout.textLayers', 'TEXT_LAYER_DUPLICATE', 'Cada capa de texto debe aparecer una sola vez'));
  textLayers.forEach((layer: any, index: number) => {
    const path = `layout.textLayers.${index}`;
    const layerId = String(layer?.id || '');
    if (!TEXT_LAYER_IDS.has(layerId) && !/^custom-[a-z0-9-]{1,64}$/i.test(layerId)) errors.push(issue(`${path}.id`, 'TEXT_LAYER_ID_INVALID', 'La capa de texto no esta soportada'));
    if (typeof layer?.text !== 'string' || layer.text.length > 160) errors.push(issue(`${path}.text`, 'TEXT_INVALID', 'El texto debe tener maximo 160 caracteres'));
    if (!finiteInRange(layer?.x, 0, 100) || !finiteInRange(layer?.y, 0, 100) || !finiteInRange(layer?.width, 1, 100) || Number(layer.x) + Number(layer.width) > 100) errors.push(issue(path, 'TEXT_BOUNDS_INVALID', 'La capa de texto debe permanecer dentro del lienzo'));
    if (!boundedInteger(layer?.size, 8, 54)) errors.push(issue(`${path}.size`, 'TEXT_SIZE_INVALID', 'El tamano debe estar entre 8 y 54'));
    if (!/^#[0-9a-f]{6}$/i.test(String(layer?.color || ''))) errors.push(issue(`${path}.color`, 'TEXT_COLOR_INVALID', 'El color debe usar formato hexadecimal'));
    if (!TEXT_FONTS.has(String(layer?.font || ''))) errors.push(issue(`${path}.font`, 'TEXT_FONT_INVALID', 'La fuente no esta soportada'));
    if (layer?.fontResourceId !== undefined && layer?.fontResourceId !== null && !/^\d+$/.test(String(layer.fontResourceId))) errors.push(issue(`${path}.fontResourceId`, 'FONT_RESOURCE_ID_INVALID', 'La fuente seleccionada no es valida'));
  });

  const stickerLayers = Array.isArray(layout.stickerLayers) ? layout.stickerLayers : [];
  if (!Array.isArray(layout.stickerLayers)) errors.push(issue('layout.stickerLayers', 'STICKER_LAYERS_INVALID', 'Los stickers deben ser un arreglo'));
  if (stickerLayers.length > 10) errors.push(issue('layout.stickerLayers', 'STICKER_LIMIT_EXCEEDED', 'Puedes agregar hasta 10 stickers'));
  const stickerIds = stickerLayers.map((layer: any) => String(layer?.id || ''));
  const stickerResourceIds = stickerLayers.map((layer: any) => String(layer?.resourceId || ''));
  if (new Set(stickerIds).size !== stickerIds.length || stickerIds.some((id: string) => !/^sticker-[a-z0-9-]{1,64}$/i.test(id))) errors.push(issue('layout.stickerLayers', 'STICKER_ID_INVALID', 'Cada sticker debe tener un identificador unico'));
  if (stickerResourceIds.some((id: string) => !/^\d+$/.test(id))) errors.push(issue('layout.stickerLayers', 'STICKER_RESOURCE_INVALID', 'Cada sticker debe usar un recurso valido'));
  const stickerOrders = stickerLayers.map((layer: any) => layer?.order).filter((order: any) => Number.isInteger(order));
  if (new Set(stickerOrders).size !== stickerOrders.length) errors.push(issue('layout.stickerLayers', 'STICKER_ORDER_DUPLICATE', 'Cada sticker debe tener un orden unico'));
  stickerLayers.forEach((layer: any, index: number) => {
    const path = `layout.stickerLayers.${index}`;
    const x = Number(layer?.x); const y = Number(layer?.y); const width = Number(layer?.width); const height = Number(layer?.height);
    if (!hasValidOverflowBounds([x, y, width, height])) errors.push(issue(path, 'STICKER_BOUNDS_INVALID', 'El sticker debe conservar al menos 10% visible dentro del lienzo'));
    if (!finiteInRange(layer?.rotation ?? 0, -180, 180)) errors.push(issue(`${path}.rotation`, 'STICKER_ROTATION_INVALID', 'La rotacion debe estar entre -180 y 180 grados'));
    if (!boundedInteger(layer?.order ?? index, 0, 9)) errors.push(issue(`${path}.order`, 'STICKER_ORDER_INVALID', 'El orden del sticker no es valido'));
  });

  const resources = config.resources || {};
  const animationIds = Array.isArray(resources.animationResourceIds) ? resources.animationResourceIds.map(String) : [];
  if (!Array.isArray(resources.animationResourceIds)) errors.push(issue('resources.animationResourceIds', 'ANIMATION_RESOURCES_INVALID', 'Las animaciones deben ser un arreglo'));
  if (new Set(animationIds).size !== animationIds.length) errors.push(issue('resources.animationResourceIds', 'ANIMATION_RESOURCE_DUPLICATE', 'Una animacion no puede repetirse'));
  textLayers.forEach((layer: any, index: number) => {
    if (layer?.font === 'resource' && !layer?.fontResourceId && !resources.fontResourceId) errors.push(issue(`layout.textLayers.${index}.fontResourceId`, 'FONT_RESOURCE_REQUIRED', 'Selecciona una fuente del pool para esta capa'));
  });

  const capture = config.capture || {};
  ['firstCountdownSeconds', 'nextCountdownSeconds', 'reviewSeconds'].forEach((key) => {
    if (!boundedInteger(capture[key], 1, 30)) errors.push(issue(`capture.${key}`, 'CAPTURE_TIME_INVALID', 'El tiempo debe estar entre 1 y 30 segundos'));
  });
  if (!LENSES.has(String(capture.lens || ''))) errors.push(issue('capture.lens', 'LENS_INVALID', 'La lente seleccionada no esta soportada'));
  if (!QUALITIES.has(String(capture.quality || ''))) errors.push(issue('capture.quality', 'QUALITY_INVALID', 'La calidad seleccionada no esta soportada'));
  ['flashEnabled', 'preserveOriginals', 'roamingMode'].forEach((key) => {
    if (typeof capture[key] !== 'boolean') errors.push(issue(`capture.${key}`, 'BOOLEAN_REQUIRED', 'El valor debe ser booleano'));
  });

  const experience = config.experience || {};
  if (!EXPERIENCE_STYLES.has(String(experience.style || ''))) errors.push(issue('experience.style', 'EXPERIENCE_STYLE_INVALID', 'El estilo de experiencia no esta soportado'));
  if (typeof experience.virtualAssistantEnabled !== 'boolean') errors.push(issue('experience.virtualAssistantEnabled', 'BOOLEAN_REQUIRED', 'El asistente virtual debe ser booleano'));
  if (!experience.randomByStage || typeof experience.randomByStage !== 'object' || Array.isArray(experience.randomByStage)) errors.push(issue('experience.randomByStage', 'RANDOM_STAGES_INVALID', 'Las etapas aleatorias deben ser un objeto'));
  else Object.entries(experience.randomByStage).forEach(([stage, enabled]) => {
    if (!ANIMATION_STAGE_SET.has(stage)) errors.push(issue(`experience.randomByStage.${stage}`, 'ANIMATION_STAGE_INVALID', 'La etapa de animacion no esta soportada'));
    if (typeof enabled !== 'boolean') errors.push(issue(`experience.randomByStage.${stage}`, 'BOOLEAN_REQUIRED', 'El valor debe ser booleano'));
  });

  if (config.gif?.enabled) errors.push(issue('gif.enabled', 'CAPABILITY_UNAVAILABLE', 'La generacion GIF aun no esta disponible'));
  if (config.backgroundRemoval?.enabled) errors.push(issue('backgroundRemoval.enabled', 'CAPABILITY_UNAVAILABLE', 'La eliminacion de fondo aun no esta disponible'));
  const print = config.print || {};
  if (Number(print.paperWidthCm) !== 10 || Number(print.paperHeightCm) !== 14.8 || print.orientation !== 'portrait' || Number(print.dpi) !== 300 || Number(print.copies) !== 1 || print.fit !== 'contain') errors.push(issue('print', 'PRINT_FORMAT_INVALID', 'La impresion debe usar 10 x 14.8 cm, retrato, 300 DPI, una copia y ajuste contain'));
  if (config.print?.enabled || config.delivery?.print) errors.push(issue('print.enabled', 'CAPABILITY_UNAVAILABLE', 'La impresion fisica aun no esta disponible'));
  ['qr', 'share', 'download', 'print'].forEach((key) => {
    if (typeof config.delivery?.[key] !== 'boolean') errors.push(issue(`delivery.${key}`, 'BOOLEAN_REQUIRED', 'El valor de entrega debe ser booleano'));
  });
  if (!boundedInteger(config.runtime?.autoResetSeconds, 5, 300)) errors.push(issue('runtime.autoResetSeconds', 'AUTO_RESET_INVALID', 'El reinicio debe estar entre 5 y 300 segundos'));
  if (typeof config.runtime?.operatorMenuEnabled !== 'boolean') errors.push(issue('runtime.operatorMenuEnabled', 'BOOLEAN_REQUIRED', 'El menu del operador debe ser booleano'));
  if (publish && !resources.layoutTemplateResourceId && !resources.templateResourceId && !resources.frameResourceId && !frameLayers.length) errors.push(issue('resources', 'FRAME_REQUIRED', 'Selecciona una plantilla o marco antes de publicar'));
  return { valid: errors.length === 0, errors, warnings };
}
