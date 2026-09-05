import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { canonicalPhotoLayoutTemplate, photoLayoutContentHash, validatePhotoLayoutTemplate } from '../src/domain/photo-layout-template.ts';
import { photoLayoutPreviewSvg, renderPhotoLayoutTemplateVariants } from '../src/lib/photo-layout-preview.mjs';

const template = canonicalPhotoLayoutTemplate({
  schemaVersion: 1,
  kind: 'mirror-photo-layout',
  baseFormat: 'recuerdo',
  output: { width: 1200, height: 1800 },
  shotCount: 3,
  order: [2, 1, 3],
  slots: [
    { photoNumber: 1, x: 13, y: 9, width: 74, height: 32 },
    { photoNumber: 2, x: 13, y: 44.5, width: 35.7, height: 28.5 },
    { photoNumber: 3, x: 51.3, y: 44.5, width: 35.7, height: 28.5 },
  ],
  duplicateStrip: false,
});

describe('PhotoLayoutTemplateV1', () => {
  it('keeps every fixed format as a valid global template', () => {
    const definitions = JSON.parse(fs.readFileSync(new URL('../resources/photo-layout-templates.json', import.meta.url), 'utf8'));
    expect(definitions).toHaveLength(6);
    definitions.forEach((definition: any) => {
      expect(validatePhotoLayoutTemplate(definition.template).valid).toBe(true);
      expect(definition.template.baseFormat).toBe('personalizar-5x15');
      expect(definition.template.output).toEqual({ width: 2000, height: 2960 });
    });
  });

  it('preserves normalized geometry and validates it', () => {
    expect(validatePhotoLayoutTemplate(template)).toEqual({ valid: true, errors: [] });
    expect(template.slots[1]).toEqual({ slotId: 'slot-2', photoNumber: 2, x: 13, y: 44.5, width: 35.7, height: 28.5, rotation: 0 });
    expect(photoLayoutContentHash(template)).toHaveLength(64);
  });

  it('rejects a slot outside the canvas', () => {
    const invalid = { ...template, slots: template.slots.map((slot, index) => index ? slot : { ...slot, x: 50, width: 74 }) };
    expect(validatePhotoLayoutTemplate(invalid).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SLOT_BOUNDS_INVALID' })]));
  });

  it('persists valid shot rotation and rejects angles outside the contract', () => {
    const rotated = canonicalPhotoLayoutTemplate({ ...template, slots: template.slots.map((slot, index) => index ? slot : { ...slot, rotation: 32.5 }) });
    expect(rotated.slots[0].rotation).toBe(32.5);
    expect(validatePhotoLayoutTemplate(rotated).valid).toBe(true);
    expect(photoLayoutPreviewSvg(rotated, 160)).toContain('transform="rotate(32.5');
    expect(validatePhotoLayoutTemplate({ ...rotated, slots: rotated.slots.map((slot, index) => index ? slot : { ...slot, rotation: 181 }) }).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SLOT_ROTATION_INVALID' })]));
  });

  it('renders capture-order numbers from the same slot geometry', async () => {
    const svg = photoLayoutPreviewSvg(template, 160);
    expect(svg).toContain('>2</text>');
    expect(svg).toContain('>1</text>');
    const variants = await renderPhotoLayoutTemplateVariants(template);
    expect(variants.map((item) => [item.variant, item.width, item.height])).toEqual([['thumb', 160, 160], ['card', 512, 512]]);
    expect(variants.every((item) => item.buffer.byteLength > 0)).toBe(true);
  });

  it('renders both copies of a duplicated strip', () => {
    const svg = photoLayoutPreviewSvg({ ...template, baseFormat: 'personalizar-5x15', output: { width: 2000, height: 2960 }, duplicateStrip: true }, 160);
    expect(svg).toContain('data-copy="left"');
    expect(svg).toContain('data-copy="right"');
  });

  it('allows independent visual slots to repeat the same capture', () => {
    const repeated = canonicalPhotoLayoutTemplate({
      ...template,
      slots: [...template.slots, { ...template.slots[0], slotId: 'slot-1-2', x: 5, y: 74, width: 30, height: 20 }],
    });
    expect(validatePhotoLayoutTemplate(repeated)).toEqual({ valid: true, errors: [] });
    expect(repeated.slots.filter((slot) => slot.photoNumber === 1)).toHaveLength(2);
    const svg = photoLayoutPreviewSvg(repeated, 160);
    expect((svg.match(/>2<\/text>/g) || [])).toHaveLength(2);
  });

  it('requires every capture, unique slot identities and at most 16 visual slots', () => {
    const missingCapture = { ...template, slots: template.slots.map((slot) => ({ ...slot, photoNumber: 1 })) };
    expect(validatePhotoLayoutTemplate(missingCapture).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SLOT_NUMBER_INVALID' })]));
    const duplicateId = { ...template, slots: template.slots.map((slot) => ({ ...slot, slotId: 'same-slot' })) };
    expect(validatePhotoLayoutTemplate(duplicateId).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SLOT_ID_INVALID' })]));
    const tooMany = { ...template, slots: Array.from({ length: 17 }, (_, index) => ({ ...template.slots[index % 3], slotId: `slot-extra-${index}` })) };
    expect(validatePhotoLayoutTemplate(tooMany).errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SLOT_COUNT_INVALID' })]));
  });
});
