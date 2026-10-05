import { describe, expect, it } from 'vitest';
import {
  MIRROR_FORMATS,
  detachLegacyPhotoLayoutTemplate,
  defaultMirrorConfig,
  validateMirrorConfigLocally,
} from '../src/domain/magic-mirror-config.ts';

function validConfig() {
  return defaultMirrorConfig();
}

it('accepts shared photo/frame order without changing capture order and rejects malformed order', () => {
  const config: any = validConfig();
  config.layout.frameLayers = [{ id: 'frame-40', resourceId: '40', x: 0, y: 0, width: 100, height: 100, rotation: 0, order: 0 }];
  config.layout.photoFrameOrder = ['frame:frame-40', 'slot:slot-1'];
  expect(validateMirrorConfigLocally(config).valid).toBe(true);
  expect(detachLegacyPhotoLayoutTemplate(config).layout.photoFrameOrder).toEqual(config.layout.photoFrameOrder);
  expect(config.layout.order).toEqual([1]);
  config.layout.photoFrameOrder = ['slot:slot-1', 'slot:slot-1'];
  expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'PHOTO_FRAME_ORDER_INVALID' }));
});

function slots(count: number) {
  const height = 80 / count;
  return Array.from({ length: count }, (_, index) => ({
    photoNumber: index + 1,
    x: 10,
    y: 10 + index * height,
    width: 80,
    height,
  }));
}

describe('MirrorConfigV1 local validation', () => {
  it.each(Object.entries(MIRROR_FORMATS))('accepts format %s with its contract', (format, spec) => {
    const config = validConfig();
    const shotCount = spec.minShots;
    config.layout = {
      ...config.layout,
      format,
      output: { width: spec.width, height: spec.height },
      shotCount,
      order: Array.from({ length: shotCount }, (_, index) => index + 1),
      slots: slots(shotCount),
    };
    expect(validateMirrorConfigLocally(config).errors).toEqual([]);
  });

  it('keeps the legacy digital format compatible', () => {
    const config = validConfig();
    config.layout.format = 'digital-vertical';
    config.layout.output = { width: 1080, height: 1920 };
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
  });

  it('rejects dimensions that do not match the selected format', () => {
    const config = validConfig();
    config.layout.output = { width: 1080, height: 1920 };
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'OUTPUT_FORMAT_MISMATCH' }));
  });

  it('rejects slots outside the canvas and incomplete order', () => {
    const config = validConfig();
    config.layout.slots[0] = { photoNumber: 1, x: 70, y: 10, width: 40, height: 40 };
    config.layout.order = [];
    const result = validateMirrorConfigLocally(config);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'SLOT_BOUNDS_INVALID' }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'SHOT_ORDER_INVALID' }));
  });

  it('accepts historical slots and validates optional shot rotation', () => {
    const config = validConfig();
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    (config.layout.slots[0] as any).rotation = -35;
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    (config.layout.slots[0] as any).rotation = 181;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'SLOT_ROTATION_INVALID' }));
  });

  it('allows up to 16 visual slots to repeat captures while requiring every shot', () => {
    const config = validConfig();
    config.layout.slots.push({ ...config.layout.slots[0], slotId: 'slot-1-2', x: 10, y: 55, width: 40, height: 35 });
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.layout.slots[1].slotId = 'slot-1';
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'SLOT_ID_INVALID' }));
  });

  it('validates text geometry, font and uploaded font requirement', () => {
    const config = validConfig();
    config.layout.textLayers = [{ id: 'name', text: 'ViralCo', x: 20, y: 80, width: 60, size: 22, color: '#111827', font: 'resource' }];
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'FONT_RESOURCE_REQUIRED' }));
    config.resources.fontResourceId = '44';
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
  });

  it('accepts custom text layers with their own font resource', () => {
    const config = validConfig();
    config.layout.textLayers = [{ id: 'custom-title', text: 'Bienvenidos', x: 10, y: 8, width: 80, size: 24, color: '#111827', font: 'resource', fontResourceId: '45' }];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
  });

  it('accepts ordered rotated text layers and rejects invalid rotation', () => {
    const config = validConfig();
    config.layout.textLayers = [
      { id: 'custom-title', text: 'Bienvenidos', x: 10, y: 8, width: 80, size: 24, color: '#111827', font: 'arial', rotation: 20, order: 0 },
    ];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.layout.textLayers[0].rotation = 181;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'TEXT_ROTATION_INVALID' }));
  });

  it('validates sticker geometry', () => {
    const config = validConfig();
    config.layout.stickerLayers = [{ id: 'sticker-70', resourceId: '70', x: 10, y: 10, width: 25, height: 25, rotation: 15, order: 0 }];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.layout.stickerLayers[0].x = -24;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'STICKER_BOUNDS_INVALID' }));
  });

  it('accepts backgrounds and stickers outside the canvas when ten percent remains visible', () => {
    const config = validConfig();
    config.layout.backgroundLayers = [
      { id: 'background-color-overflow', kind: 'color', resourceId: null, color: '#2D3047', x: -90, y: 0, width: 100, height: 100, rotation: 0, order: 0 },
    ];
    config.layout.stickerLayers = [
      { id: 'sticker-70', resourceId: '70', x: -22.5, y: 10, width: 25, height: 25, rotation: 0, order: 0 },
    ];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);

    config.layout.backgroundLayers[0].x = -91;
    config.layout.stickerLayers[0].x = -23;
    const errors = validateMirrorConfigLocally(config).errors;
    expect(errors).toContainEqual(expect.objectContaining({ code: 'BACKGROUND_BOUNDS_INVALID' }));
    expect(errors).toContainEqual(expect.objectContaining({ code: 'STICKER_BOUNDS_INVALID' }));
  });

  it('allows color backgrounds up to twice the canvas dimensions only', () => {
    const config = validConfig();
    config.layout.backgroundLayers = [
      { id: 'background-color-large', kind: 'color', resourceId: null, color: '#2D3047', x: -50, y: -50, width: 200, height: 200, rotation: 0, order: 0 },
    ];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.layout.backgroundLayers[0].width = 201;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'BACKGROUND_BOUNDS_INVALID' }));

    config.layout.backgroundLayers[0] = { id: 'background-resource-large', kind: 'resource', resourceId: '80', color: null, x: 0, y: 0, width: 101, height: 100, rotation: 0, order: 0 };
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'BACKGROUND_BOUNDS_INVALID' }));
  });

  it('allows multiple visual sticker layers to reuse one static resource', () => {
    const config = validConfig();
    config.layout.stickerLayers = [
      { id: 'sticker-70', resourceId: '70', x: 10, y: 10, width: 25, height: 25, rotation: 0, order: 0 },
      { id: 'sticker-70-2', resourceId: '70', x: 20, y: 20, width: 25, height: 25, rotation: 20, order: 1 },
    ];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
  });

  it('accepts multiple editable frame layers and validates their limits and geometry', () => {
    const config = validConfig();
    config.layout.frameLayers = [
      { id: 'frame-40', resourceId: '40', x: 0, y: 0, width: 100, height: 100, rotation: 0, order: 0 },
      { id: 'frame-40-2', resourceId: '40', x: 5, y: 5, width: 90, height: 90, rotation: 12, order: 1 },
    ];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.layout.frameLayers[1].width = 100;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'FRAME_BOUNDS_INVALID' }));
  });

  it('accepts ordered color and resource background layers and validates their content', () => {
    const config = validConfig();
    config.layout.backgroundLayers = [
      { id: 'background-color-2D3047', kind: 'color', resourceId: null, color: '#2D3047', x: 0, y: 0, width: 100, height: 100, rotation: 0, order: 0 },
      { id: 'background-resource-80', kind: 'resource', resourceId: '80', color: null, x: 10, y: 10, width: 80, height: 80, rotation: 15, order: 1 },
    ];
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.layout.backgroundLayers[0].color = 'indigo';
    config.layout.backgroundLayers[1].order = 0;
    const errors = validateMirrorConfigLocally(config).errors;
    expect(errors).toContainEqual(expect.objectContaining({ code: 'BACKGROUND_COLOR_INVALID' }));
    expect(errors).toContainEqual(expect.objectContaining({ code: 'BACKGROUND_ORDER_INVALID' }));
  });

  it('requires a unique composition order for stickers', () => {
    const config = validConfig();
    config.layout.stickerLayers = [
      { id: 'sticker-70', resourceId: '70', x: 10, y: 10, width: 20, height: 20, rotation: 0, order: 0 },
      { id: 'sticker-71', resourceId: '71', x: 40, y: 40, width: 20, height: 20, rotation: 0, order: 0 },
    ];
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'STICKER_ORDER_DUPLICATE' }));
  });

  it('rejects unsupported capture and animation values', () => {
    const config = validConfig();
    config.capture.lens = 'telephoto';
    config.capture.quality = 'raw';
    config.experience.randomByStage = { unknown: true };
    const result = validateMirrorConfigLocally(config);
    expect(result.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining(['LENS_INVALID', 'QUALITY_INVALID', 'ANIMATION_STAGE_INVALID']));
  });

  it('accepts capture times from 0 to 20 seconds and rejects values outside that range', () => {
    const config = validConfig();
    config.capture.firstCountdownSeconds = 0;
    config.capture.nextCountdownSeconds = 20;
    config.capture.reviewSeconds = 0;
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
    config.capture.reviewSeconds = 21;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'CAPTURE_TIME_INVALID' }));
  });

  it('publishes a structurally valid layout without a template or frame', () => {
    const config = validConfig();
    expect(validateMirrorConfigLocally(config, false).valid).toBe(true);
    expect(validateMirrorConfigLocally(config, true).valid).toBe(true);
  });

  it('treats preset origin as non-binding publication metadata', () => {
    const config = validConfig();
    (config.layout as any).presetOrigin = { libraryAssetId: 'missing', name: 'Preset eliminado', source: 'global', contentHash: 'old-hash' };
    expect(validateMirrorConfigLocally(config, true).valid).toBe(true);
  });

  it('detaches a legacy template reference without changing its geometry', () => {
    const config = validConfig();
    config.layout.slots[0] = { ...config.layout.slots[0], x: 19, y: 23, rotation: 11 } as any;
    config.resources.layoutTemplateResourceId = '88';
    const detached = detachLegacyPhotoLayoutTemplate(config);
    expect(detached.layout).toEqual(config.layout);
    expect(detached.resources.layoutTemplateResourceId).toBeNull();
    expect(config.resources.layoutTemplateResourceId).toBe('88');
  });

  it('keeps GIF and background removal unavailable while allowing configured printing', () => {
    const config = validConfig();
    config.gif.enabled = true;
    config.backgroundRemoval.enabled = true;
    config.print.enabled = true;
    config.print.profileResourceId = '41';
    config.delivery.print = true;
    const result = validateMirrorConfigLocally(config);
    expect(result.errors.filter((entry) => entry.code === 'CAPABILITY_UNAVAILABLE')).toHaveLength(2);
    expect(result.errors).not.toContainEqual(expect.objectContaining({ code: 'PRINT_PROFILE_REQUIRED' }));
  });

  it('requires a profile when physical printing is enabled', () => {
    const config = validConfig();
    config.print.enabled = true;
    config.delivery.print = true;
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'PRINT_PROFILE_REQUIRED' }));
  });
});
