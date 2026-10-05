import { beforeEach, expect, it, vi } from 'vitest';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
const mock = vi.hoisted(() => ({ rows: [] as any[], where: vi.fn(), context: vi.fn(), sign: vi.fn(async (key: string) => `signed:${key}`) }));
vi.mock('../src/db/index.ts', () => ({ db: { select: () => {
  const query: any = { from: () => query, where: (filter: any) => { mock.where(filter); return query; }, orderBy: () => query, limit: async () => mock.rows };
  return query;
} } }));
vi.mock('../src/services/magic-mirror.service.ts', () => ({ getMirrorContext: mock.context, mapSession: vi.fn() }));
vi.mock('../src/r2.ts', () => ({ createPresignedReadUrl: mock.sign }));
import { listMirrorCompositions } from '../src/services/mirror-runtime.service.ts';
beforeEach(() => { vi.clearAllMocks(); mock.rows = []; mock.context.mockResolvedValue({ eventId: 1n, eventModeId: 2n }); });
it('scopes all-device results to authorized event/mode and synced photos, with keyset pagination', async () => {
  mock.rows = Array.from({ length: 31 }, (_, index) => ({ id: BigInt(90 - index), eventId: 1n, eventModeId: 2n, storageKey: `photo${index}`, eventModeSessionId: BigInt(index + 1) }));
  const result = await listMirrorCompositions('1', '2', null, { id: 'user' });
  expect(mock.context).toHaveBeenCalledWith('1', '2', { id: 'user' }, 'events.view');
  const query = new MySqlDialect().sqlToQuery(mock.where.mock.calls[0][0]);
  expect(query.sql).toContain('`event_id`');
  expect(query.sql).toContain('`event_mode_id`');
  expect(query.sql).not.toContain('`event_mode_session_id`');
  expect(query.params).toEqual(expect.arrayContaining(['photo', 'synced']));
  expect(result.items).toHaveLength(30);
  expect(result.nextCursor).toBe('61');
  expect(mock.sign).toHaveBeenCalledTimes(30);
});
it('does not read or sign photos when access is denied', async () => {
  mock.context.mockRejectedValueOnce(new Error('Forbidden'));
  await expect(listMirrorCompositions('1', '2', null, {})).rejects.toThrow('Forbidden');
  expect(mock.where).not.toHaveBeenCalled(); expect(mock.sign).not.toHaveBeenCalled();
});
it('returns an empty page without a cursor', async () => {
  expect(await listMirrorCompositions('1', '2', null, {})).toEqual({ items: [], nextCursor: null });
});
