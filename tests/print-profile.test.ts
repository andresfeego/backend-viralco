import { describe, expect, it } from 'vitest';
import { canonicalPrintProfile, printProfileContentHash, validatePrintProfile } from '../src/domain/print-profile.ts';

const canonProfile = {
  schemaVersion: 1,
  kind: 'print-profile',
  manufacturer: 'Canon',
  model: 'SELPHY CP1500',
  paper: { name: 'Postal', widthMm: 100, heightMm: 148, orientation: 'portrait', borderless: true, safeMarginMm: 1.8 },
  output: { dpi: 300, fit: 'contain', defaultCopies: 1, maxCopies: 20, supportsTwoPerPage: true, colorMode: 'color' },
  compatibility: { transports: ['airprint'], platforms: ['ios'] },
};

describe('PrintProfileV1', () => {
  it('acepta el perfil Canon CP1500 canónico', () => {
    const profile = canonicalPrintProfile(canonProfile);
    expect(validatePrintProfile(profile)).toEqual({ valid: true, errors: [] });
    expect(printProfileContentHash(profile)).toHaveLength(64);
  });

  it('rechaza tamaños, copias y transportes inválidos', () => {
    const profile = canonicalPrintProfile({
      ...canonProfile,
      paper: { ...canonProfile.paper, widthMm: 0 },
      output: { ...canonProfile.output, defaultCopies: 0 },
      compatibility: { transports: ['bluetooth'], platforms: ['ios'] },
    });
    const result = validatePrintProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      'paper.widthMm',
      'output.defaultCopies',
      'compatibility.transports',
    ]));
  });
});
