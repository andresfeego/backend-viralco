import { describe, expect, it } from 'vitest';
import { normalizePrintGuide, validateManual } from '../src/domain/print-guide.ts';
describe('printer guides', () => {
  it('accepts an optional manual and trims ordered manual steps', () => {
    expect(normalizePrintGuide({ steps: [' One ', 'Two'], sourceUrl: '' })).toEqual({ schemaVersion: 1, steps: ['One', 'Two'], sourceUrl: '', stepsByPlatform: { ios: [], android: [] } });
    expect(normalizePrintGuide({ steps: [], sourceUrl: 'https://canon.com/manual' }).steps).toEqual([]);
  });
  it.each(['javascript:alert(1)', 'http://canon.com', 'https://name:secret@canon.com', 'invalid'])('rejects unsafe source %s', sourceUrl => {
    expect(() => normalizePrintGuide({ steps: [], sourceUrl })).toThrow();
  });
  it('bounds content and rejects malformed steps', () => {
    for (const steps of [null, [''], [23], Array(31).fill('step'), ['x'.repeat(2001)]]) expect(() => normalizePrintGuide({ steps })).toThrow();
  });
  it('validates PDF bytes, MIME and size', () => {
    expect(() => validateManual({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') })).not.toThrow();
    expect(() => validateManual({ mimetype: 'application/pdf', buffer: Buffer.from('<html>') })).toThrow();
    expect(() => validateManual({ mimetype: 'text/html', buffer: Buffer.from('%PDF-') })).toThrow();
    expect(() => validateManual({ mimetype: 'application/pdf', buffer: Buffer.alloc(26 * 1024 * 1024) })).toThrow();
  });
});
