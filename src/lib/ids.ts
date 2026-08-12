export type EntityId = bigint;

export function parseEntityId(value: unknown, label = 'ID'): EntityId {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw) || raw === '0') {
    throw new Error(`${label} invalido`);
  }
  return BigInt(raw);
}

export function serializeId(value: bigint | number | string | null | undefined) {
  return value == null ? null : String(value);
}
