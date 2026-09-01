import { describe, expect, it } from 'vitest';
import {
  MIRROR_FORMATS,
  defaultMirrorConfig,
  validateMirrorConfigLocally,
} from '../src/domain/magic-mirror-config.ts';

function validConfig() {
  return defaultMirrorConfig();
}

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

  it('validates text geometry, font and uploaded font requirement', () => {
    const config = validConfig();
    config.layout.textLayers = [{ id: 'name', text: 'ViralCo', x: 20, y: 80, width: 60, size: 22, color: '#111827', font: 'resource' }];
    expect(validateMirrorConfigLocally(config).errors).toContainEqual(expect.objectContaining({ code: 'FONT_RESOURCE_REQUIRED' }));
    config.resources.fontResourceId = '44';
    expect(validateMirrorConfigLocally(config).valid).toBe(true);
  });

  it('rejects unsupported capture and animation values', () => {
    const config = validConfig();
    config.capture.lens = 'telephoto';
    config.capture.quality = 'raw';
    config.experience.randomByStage = { unknown: true };
    const result = validateMirrorConfigLocally(config);
    expect(result.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining(['LENS_INVALID', 'QUALITY_INVALID', 'ANIMATION_STAGE_INVALID']));
  });

  it('requires a frame or template only for publication', () => {
    const config = validConfig();
    expect(validateMirrorConfigLocally(config, false).valid).toBe(true);
    expect(validateMirrorConfigLocally(config, true).errors).toContainEqual(expect.objectContaining({ code: 'FRAME_REQUIRED' }));
  });

  it('keeps unavailable capabilities disabled', () => {
    const config = validConfig();
    config.gif.enabled = true;
    config.backgroundRemoval.enabled = true;
    config.print.enabled = true;
    const result = validateMirrorConfigLocally(config);
    expect(result.errors.filter((entry) => entry.code === 'CAPABILITY_UNAVAILABLE')).toHaveLength(3);
  });
});
