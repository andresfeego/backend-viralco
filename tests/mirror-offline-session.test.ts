import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/offline-authorization.service.ts', () => ({ assertRuntimeBilling: vi.fn(async () => {}) }));
const mock = vi.hoisted(() => {
  const rows: any[][] = [];
  const select = vi.fn(() => { const q: any = {}; q.from = q.where = () => q; q.limit = async () => rows.shift(); return q; });
  const values = vi.fn(async () => [{ insertId: 9 }]);
  const set = vi.fn(() => ({ where: async () => undefined }));
  const db: any = { select, insert: vi.fn(() => ({ values })), update: vi.fn(() => ({ set })), execute: vi.fn(async () => []) };
  db.transaction = (fn: any) => fn(db);
  return { rows, db, values, set, access: vi.fn(async () => ({ eventModeId: 2n })) };
});
vi.mock('../src/db/index.ts', () => ({ db: mock.db }));
vi.mock('../src/services/magic-mirror.service.ts', () => ({ getMirrorContext: mock.access, mapSession: (value: any) => value }));
import { registerOfflineMirrorSession } from '../src/services/mirror-offline-session.service.ts';
const input = { clientSessionId: '00000000-0000-4000-8000-000000000001', deviceInstallationId: 'phone', configVersionId: '3', startedAt: '2026-01-01T00:00:00Z', through: '2026-01-01T01:00:00Z' };
const session = { id: 9n, eventModeId: 2n, configVersionId: 3n, deviceInstallationId: 'phone', startedBy: 1n, status: 'ended', metadata: { offline: true }, endedAt: new Date(input.through) };
beforeEach(() => { vi.clearAllMocks(); mock.rows.length = 0; });
it('registers historical publication as ended without taking over the live session', async () => {
  mock.rows.push([{ id: 3n }], [], [session]);
  await registerOfflineMirrorSession('1', '2', input, { id: '1' });
  expect(mock.access).toHaveBeenCalledWith('1', '2', { id: '1' }, 'capture.operate');
  expect(mock.values).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended', configVersionId: 3n, metadata: { offline: true } }));
});
it('reconciles repeated synchronization idempotently', async () => {
  mock.rows.push([{ id: 3n }], [session]);
  expect((await registerOfflineMirrorSession('1', '2', input, { id: '1' })).id).toBe(9n);
  expect(mock.db.insert).not.toHaveBeenCalled();
});
it.each([
  { deviceInstallationId: 'other' }, { startedBy: 2n }, { configVersionId: 4n }, { status: 'running' }, { metadata: {} },
])('rejects an incompatible idempotency key: %#', async patch => {
  mock.rows.push([{ id: 3n }], [{ ...session, ...patch }]);
  await expect(registerOfflineMirrorSession('1', '2', input, { id: '1' })).rejects.toThrow('Sesion offline incompatible');
  expect(mock.db.update).not.toHaveBeenCalled();
});
it('rejects a publication outside the authorized event', async () => {
  mock.rows.push([]);
  await expect(registerOfflineMirrorSession('1', '2', input, { id: '1' })).rejects.toThrow('Publicacion no encontrada');
});
it('rejects a future capture timestamp', async () => {
  await expect(registerOfflineMirrorSession('1', '2', { ...input, through: '2999-01-01' }, { id: '1' })).rejects.toThrow('Fecha de sesion invalida');
});
