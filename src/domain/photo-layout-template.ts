import { createHash } from 'node:crypto';
import { MIRROR_FORMATS } from './magic-mirror-config.ts';

export const PHOTO_LAYOUT_TEMPLATE_SCHEMA_VERSION = 1;
export const PHOTO_LAYOUT_TEMPLATE_KIND = 'mirror-photo-layout';
export const PHOTO_LAYOUT_TEMPLATE_MIME = 'application/vnd.kaptura.photo-layout+json';
export const PHOTO_LAYOUT_PREVIEW_RENDERER_VERSION = 4;
export const PHOTO_LAYOUT_EDITABLE_FORMAT = 'personalizar-5x15';
export const PHOTO_LAYOUT_CANVAS = { width: 2000, height: 2960 } as const;

export type PhotoLayoutSlot = { slotId: string; photoNumber: number; x: number; y: number; width: number; height: number; rotation: number };
export type PhotoLayoutTemplateV1 = {
  schemaVersion: 1;
  kind: 'mirror-photo-layout';
  baseFormat: string;
  output: { width: number; height: number };
  shotCount: number;
  order: number[];
  slots: PhotoLayoutSlot[];
  duplicateStrip: boolean;
};

function rounded(value: unknown) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function photoLayoutFromMirrorLayout(layout: any): PhotoLayoutTemplateV1 {
  const usedSlotIds = new Set<string>();
  const occurrences = new Map<number, number>();
  return {
    schemaVersion: PHOTO_LAYOUT_TEMPLATE_SCHEMA_VERSION,
    kind: PHOTO_LAYOUT_TEMPLATE_KIND,
    baseFormat: String(layout?.format || ''),
    output: { width: Number(layout?.output?.width), height: Number(layout?.output?.height) },
    shotCount: Number(layout?.shotCount),
    order: Array.isArray(layout?.order) ? layout.order.map(Number) : [],
    slots: Array.isArray(layout?.slots) ? layout.slots.map((slot: any) => {
      const photoNumber = Number(slot?.photoNumber);
      const occurrence = (occurrences.get(photoNumber) || 0) + 1;
      occurrences.set(photoNumber, occurrence);
      const suppliedSlotId = slot?.slotId !== undefined && slot?.slotId !== null ? String(slot.slotId) : null;
      let slotId = suppliedSlotId || `slot-${photoNumber}${occurrence > 1 ? `-${occurrence}` : ''}`;
      let suffix = occurrence;
      while (!suppliedSlotId && usedSlotIds.has(slotId)) { suffix += 1; slotId = `slot-${photoNumber}-${suffix}`; }
      usedSlotIds.add(slotId);
      return {
        slotId,
        photoNumber,
        x: rounded(slot?.x), y: rounded(slot?.y), width: rounded(slot?.width), height: rounded(slot?.height),
        rotation: rounded(slot?.rotation ?? 0),
      };
    }) : [],
    duplicateStrip: Boolean(layout?.duplicateStrip),
  };
}

export function validatePhotoLayoutTemplate(input: any) {
  const errors: Array<{ path: string; code: string; message: string }> = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [{ path: 'template', code: 'TEMPLATE_INVALID', message: 'La plantilla debe ser un objeto' }] };
  if (Number(input.schemaVersion) !== 1) errors.push({ path: 'schemaVersion', code: 'SCHEMA_VERSION_INVALID', message: 'Version de plantilla no soportada' });
  if (input.kind !== PHOTO_LAYOUT_TEMPLATE_KIND) errors.push({ path: 'kind', code: 'KIND_INVALID', message: 'Tipo de plantilla no soportado' });
  const format = String(input.baseFormat || '');
  const spec = MIRROR_FORMATS[format as keyof typeof MIRROR_FORMATS];
  const shotCount = Number(input.shotCount);
  if (!spec || (spec as any).legacy) errors.push({ path: 'baseFormat', code: 'FORMAT_INVALID', message: 'Formato base invalido' });
  if (spec) {
    if (Number(input.output?.width) !== spec.width || Number(input.output?.height) !== spec.height) errors.push({ path: 'output', code: 'OUTPUT_FORMAT_MISMATCH', message: 'Las dimensiones no corresponden al formato' });
    if (!Number.isInteger(shotCount) || shotCount < spec.minShots || shotCount > spec.maxShots) errors.push({ path: 'shotCount', code: 'SHOT_COUNT_INVALID', message: 'Cantidad de tomas invalida' });
    if (input.duplicateStrip === true && !spec.duplicateStrip) errors.push({ path: 'duplicateStrip', code: 'DUPLICATE_STRIP_UNAVAILABLE', message: 'La tira duplicada no aplica a este formato' });
  }
  if (typeof input.duplicateStrip !== 'boolean') errors.push({ path: 'duplicateStrip', code: 'BOOLEAN_REQUIRED', message: 'duplicateStrip debe ser booleano' });
  const expected = Array.from({ length: Number.isInteger(shotCount) ? shotCount : 0 }, (_, index) => index + 1);
  const order = Array.isArray(input.order) ? input.order.map(Number) : [];
  if (order.length !== shotCount || new Set(order).size !== shotCount || order.some((value) => !expected.includes(value))) errors.push({ path: 'order', code: 'ORDER_INVALID', message: 'El orden debe incluir cada toma una vez' });
  const slots = Array.isArray(input.slots) ? input.slots : [];
  if (slots.length < shotCount || slots.length > 16) errors.push({ path: 'slots', code: 'SLOT_COUNT_INVALID', message: 'Debe existir al menos un espacio por toma y maximo 16 espacios visuales' });
  const slotNumbers = slots.map((slot: any) => Number(slot?.photoNumber));
  if (slotNumbers.some((value: number) => !expected.includes(value)) || expected.some((value) => !slotNumbers.includes(value))) errors.push({ path: 'slots', code: 'SLOT_NUMBER_INVALID', message: 'Cada toma debe estar representada en al menos un espacio' });
  const suppliedSlotIds = slots.map((slot: any) => slot?.slotId).filter((value: any) => value !== undefined && value !== null);
  if (suppliedSlotIds.some((value: any) => !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(String(value))) || new Set(suppliedSlotIds.map(String)).size !== suppliedSlotIds.length) errors.push({ path: 'slots', code: 'SLOT_ID_INVALID', message: 'Cada espacio visual debe tener un identificador unico valido' });
  slots.forEach((slot: any, index: number) => {
    const [x, y, width, height] = [slot?.x, slot?.y, slot?.width, slot?.height].map(Number);
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) errors.push({ path: `slots.${index}`, code: 'SLOT_BOUNDS_INVALID', message: 'El espacio debe permanecer dentro del lienzo' });
    const rotation = Number(slot?.rotation ?? 0);
    if (!Number.isFinite(rotation) || rotation < -180 || rotation > 180) errors.push({ path: `slots.${index}.rotation`, code: 'SLOT_ROTATION_INVALID', message: 'La rotacion debe estar entre -180 y 180 grados' });
  });
  return { valid: errors.length === 0, errors };
}

export function canonicalPhotoLayoutTemplate(input: any) {
  const value = photoLayoutFromMirrorLayout({
    format: input?.baseFormat,
    output: input?.output,
    shotCount: input?.shotCount,
    order: input?.order,
    slots: input?.slots,
    duplicateStrip: input?.duplicateStrip,
  });
  return value;
}

export function photoLayoutContentHash(template: PhotoLayoutTemplateV1) {
  return createHash('sha256').update(JSON.stringify(template)).digest('hex');
}
