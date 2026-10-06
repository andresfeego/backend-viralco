import { beforeEach, expect, it, vi } from 'vitest';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
const mock = vi.hoisted(() => ({ rows: [] as any[], context: vi.fn(), access: vi.fn(), billing: vi.fn(), update: vi.fn(), where: vi.fn() }));
vi.mock('../src/services/offline-authorization.service.ts', () => ({ assertRuntimeBilling: mock.billing }));
vi.mock('../src/services/event-access.service.ts', () => ({ assertEventAccess: mock.access }));
vi.mock('../src/db/index.ts', () => ({ db: {
  select: () => {
    const query: any = { from: () => query, where: (where: any) => { mock.where(where); return query; }, limit: async () => mock.rows,
      then: (resolve: any) => Promise.resolve(mock.rows).then(resolve) };
    return query;
  },
  update: () => ({ set: (value: any) => { mock.update(value); return { where: async (where: any) => mock.where(where) }; } }),
} }));
vi.mock('../src/services/magic-mirror.service.ts', () => ({ getMirrorContext: mock.context, mapSession: vi.fn() }));
vi.mock('../src/r2.ts', () => ({}));
import { getCompositionArchiveStates, setCompositionArchiveState } from '../src/services/mirror-runtime.service.ts';
const id = 'ccba5cde-537c-4375-b9a4-75c2d1c6d6dd';
beforeEach(() => { vi.clearAllMocks(); mock.rows = []; mock.context.mockResolvedValue({ eventId: 1n, eventModeId: 2n, event: { accountId: 3n } }); });
it('returns shared archive and restore states scoped to the authorized event and mode', async () => {
  mock.rows = [{ clientAssetId: id, metadata: { archived: true } }, { clientAssetId: 'other', metadata: null }];
  expect((await getCompositionArchiveStates('1', '2', {})).items).toEqual([{ clientAssetId: id, archived: true }, { clientAssetId: 'other', archived: false }]);
  const query = new MySqlDialect().sqlToQuery(mock.where.mock.calls[0][0]);
  expect(query.sql).toContain('`event_id`'); expect(query.sql).toContain('`event_mode_id`');
});
it.each([true, false])('changes only archive metadata with operator authorization: %s', async (archived) => {
  mock.rows = [{ id: 1n }];
  expect(await setCompositionArchiveState('1', '2', { clientAssetId: id, archived }, {})).toMatchObject({ found: true, archived });
  expect(mock.access).toHaveBeenCalledWith(1n, {}, 'read', 'capture.operate');
  expect(Object.keys(mock.update.mock.calls[0][0]).sort()).toEqual(['metadata', 'updatedAt']);
  const query = new MySqlDialect().sqlToQuery(mock.update.mock.calls[0][0].metadata);
  expect(query.sql).toContain('json_set'); expect(query.params).toContain(JSON.stringify(archived));
});
it('does not mutate a missing or different-event asset', async () => {
  expect(await setCompositionArchiveState('1', '2', { clientAssetId: id, archived: true }, {})).toEqual({ found: false });
  expect(mock.update).not.toHaveBeenCalled();
});
it('rejects unauthorized writes and invalid states', async () => {
  await expect(setCompositionArchiveState('1', '2', { clientAssetId: id, archived: 'true' }, {})).rejects.toThrow();
  mock.context.mockRejectedValueOnce(new Error('Forbidden'));
  await expect(setCompositionArchiveState('1', '2', { clientAssetId: id, archived: true }, {})).rejects.toThrow('Forbidden');
  expect(mock.update).not.toHaveBeenCalled();
});
it('does not archive when operational billing authorization is denied', async () => {
  mock.billing.mockRejectedValueOnce(new Error('BILLING_SUBSCRIPTION_EXPIRED'));
  await expect(setCompositionArchiveState('1', '2', { clientAssetId: id, archived: true }, {})).rejects.toThrow('BILLING_SUBSCRIPTION_EXPIRED');
  expect(mock.update).not.toHaveBeenCalled();
});
