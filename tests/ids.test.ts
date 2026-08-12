import { describe, expect, it } from 'vitest';
import { parseEntityId, serializeId } from '../src/lib/ids.ts';

describe('entity ids', () => {
  it('preserves bigint precision as JSON-safe strings', () => {
    const value = parseEntityId('9007199254740993');
    expect(value).toBe(9007199254740993n);
    expect(serializeId(value)).toBe('9007199254740993');
  });

  it.each(['', '0', '-1', '1.5', 'abc'])("rejects invalid id %s", (value) => {
    expect(() => parseEntityId(value)).toThrow('ID invalido');
  });
});
