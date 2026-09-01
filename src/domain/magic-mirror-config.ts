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

export type MirrorValidationIssue = { path: string; code: string; message: string };

export const defaultMirrorConfig = () => ({
  layout: {
    format: 'digital', output: { width: 1200, height: 1500 }, shotCount: 1, order: [1],
    slots: [{ photoNumber: 1, x: 7, y: 17, width: 86, height: 66 }], duplicateStrip: false, textLayers: [],
  },
  resources: {
    templateResourceId: null, frameResourceId: null, gifOverlayResourceId: null,
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
  if (slots.length !== shotCount) errors.push(issue('layout.slots', 'SLOTS_COUNT_INVALID', 'Debe existir un slot por toma'));
  const order = Array.isArray(layout.order) ? layout.order.map(Number) : [];
  const expectedOrder = Array.from({ length: shotCount }, (_, index) => index + 1);
  if (order.length !== shotCount || new Set(order).size !== shotCount || order.some((value) => !expectedOrder.includes(value))) errors.push(issue('layout.order', 'SHOT_ORDER_INVALID', 'El orden debe incluir cada toma exactamente una vez'));
  const slotPhotoNumbers = slots.map((slot: any) => Number(slot?.photoNumber));
  if (new Set(slotPhotoNumbers).size !== slots.length || slotPhotoNumbers.some((value) => !expectedOrder.includes(value))) errors.push(issue('layout.slots', 'SLOT_PHOTO_NUMBER_INVALID', 'Cada slot debe corresponder a una toma unica'));
  slots.forEach((slot: any, index: number) => {
    const values = [slot?.x, slot?.y, slot?.width, slot?.height].map(Number);
    if (values.some((value) => !Number.isFinite(value)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 100 || values[1] + values[3] > 100) errors.push(issue(`layout.slots.${index}`, 'SLOT_BOUNDS_INVALID', 'El slot debe permanecer dentro del lienzo'));
  });

  const textLayers = Array.isArray(layout.textLayers) ? layout.textLayers : [];
  if (!Array.isArray(layout.textLayers)) errors.push(issue('layout.textLayers', 'TEXT_LAYERS_INVALID', 'Las capas de texto deben ser un arreglo'));
  const textLayerIds = textLayers.map((layer: any) => String(layer?.id || ''));
  if (new Set(textLayerIds).size !== textLayerIds.length) errors.push(issue('layout.textLayers', 'TEXT_LAYER_DUPLICATE', 'Cada capa de texto debe aparecer una sola vez'));
  textLayers.forEach((layer: any, index: number) => {
    const path = `layout.textLayers.${index}`;
    if (!TEXT_LAYER_IDS.has(String(layer?.id || ''))) errors.push(issue(`${path}.id`, 'TEXT_LAYER_ID_INVALID', 'La capa de texto no esta soportada'));
    if (typeof layer?.text !== 'string' || layer.text.length > 160) errors.push(issue(`${path}.text`, 'TEXT_INVALID', 'El texto debe tener maximo 160 caracteres'));
    if (!finiteInRange(layer?.x, 0, 100) || !finiteInRange(layer?.y, 0, 100) || !finiteInRange(layer?.width, 1, 100) || Number(layer.x) + Number(layer.width) > 100) errors.push(issue(path, 'TEXT_BOUNDS_INVALID', 'La capa de texto debe permanecer dentro del lienzo'));
    if (!boundedInteger(layer?.size, 8, 54)) errors.push(issue(`${path}.size`, 'TEXT_SIZE_INVALID', 'El tamano debe estar entre 8 y 54'));
    if (!/^#[0-9a-f]{6}$/i.test(String(layer?.color || ''))) errors.push(issue(`${path}.color`, 'TEXT_COLOR_INVALID', 'El color debe usar formato hexadecimal'));
    if (!TEXT_FONTS.has(String(layer?.font || ''))) errors.push(issue(`${path}.font`, 'TEXT_FONT_INVALID', 'La fuente no esta soportada'));
  });

  const resources = config.resources || {};
  const animationIds = Array.isArray(resources.animationResourceIds) ? resources.animationResourceIds.map(String) : [];
  if (!Array.isArray(resources.animationResourceIds)) errors.push(issue('resources.animationResourceIds', 'ANIMATION_RESOURCES_INVALID', 'Las animaciones deben ser un arreglo'));
  if (new Set(animationIds).size !== animationIds.length) errors.push(issue('resources.animationResourceIds', 'ANIMATION_RESOURCE_DUPLICATE', 'Una animacion no puede repetirse'));
  if (textLayers.some((layer: any) => layer?.font === 'resource') && !resources.fontResourceId) errors.push(issue('resources.fontResourceId', 'FONT_RESOURCE_REQUIRED', 'Selecciona una fuente del pool para las capas configuradas'));

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
  if (publish && !resources.templateResourceId && !resources.frameResourceId) errors.push(issue('resources', 'FRAME_REQUIRED', 'Selecciona una plantilla o marco antes de publicar'));
  return { valid: errors.length === 0, errors, warnings };
}

