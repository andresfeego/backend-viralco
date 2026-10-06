import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMirrorConfig } from '../src/domain/magic-mirror-config.ts';

const mock = vi.hoisted(() => {
  const rows: any[][] = [];
  const select = vi.fn(() => {
    const query: any = {};
    for (const method of ['from', 'where', 'innerJoin', 'orderBy']) query[method] = () => query;
    query.limit = async () => { if (!rows.length) throw new Error('Unexpected query'); return rows.shift(); };
    return query;
  });
  const values = vi.fn(async () => [{ insertId: 9 }]);
  const insert = vi.fn(() => ({ values }));
  const execute = vi.fn(async () => []);
  const db: any = { select, insert, execute };
  db.transaction = async (fn: any) => fn(db);
  return { db, rows, insert, execute };
});
vi.mock('../src/db/index.ts', () => ({ db: mock.db }));
vi.mock('../src/services/event-access.service.ts', () => ({ assertEventAccess: vi.fn(async () => ({})) }));
vi.mock('../src/services/subscriptions.service.ts', () => ({ assertSubscriptionIncludesModes: vi.fn(async () => ({})) }));
vi.mock('../src/services/library.service.ts', () => ({ getLibraryAssetWithVariants: vi.fn() }));
import { getMirrorConfig, startMirrorSession } from '../src/services/magic-mirror.service.ts';

const context = { event: { id: 1n, accountId: 1n, status: 'active' }, eventMode: { id: 2n, isActive: true }, mode: { slug: 'espejo' } };
const configRow = { id: 3n, publishedVersionId: 2n };
const version = (id: bigint) => ({ id, eventModeId: 2n, publishedBy: 1n, schemaVersion: 1, version: Number(id), config: defaultMirrorConfig() });
const session = (versionId: bigint) => ({ id: 9n, eventModeId: 2n, startedBy: 1n, configVersionId: versionId, status: 'preparing' });
const input = { clientSessionId: '00000000-0000-4000-8000-000000000001', deviceInstallationId: 'phone' };
beforeEach(() => { vi.clearAllMocks(); mock.rows.length = 0; });

it('keeps the previous publication but reports a changed saved draft as draft', async () => {
  const draft = defaultMirrorConfig();
  const published = structuredClone(draft);
  draft.capture.firstCountdownSeconds = 9;
  mock.rows.push([context], [{ ...configRow, config: draft, revision: 3 }], [{ config: published, version: 1 }]);
  const result = await getMirrorConfig('1', '2', { id: '1' });
  expect(result.status).toBe('draft');
  expect(result.publishedVersionId).toBe('2');
  expect(result.publishedVersion).toBe(1);
});

it('reports published only when the saved draft matches its immutable publication', async () => {
  const config = defaultMirrorConfig();
  mock.rows.push([context], [{ ...configRow, config, revision: 3 }], [{ config: JSON.stringify(config) }]);
  expect((await getMirrorConfig('1', '2', { id: '1' })).status).toBe('published');
});
function prefix(lockedVersion = 2n) {
  mock.rows.push([context], [configRow], [context], [configRow], [version(2n)], [{ ...configRow, publishedVersionId: lockedVersion }]);
}

describe('session publication consistency without a database reset', () => {
  it('pins a fresh session and returned package to the expected publication', async () => {
    prefix(); mock.rows.push([], [], [session(2n)]);
    const result = await startMirrorSession('1', '2', { ...input, expectedPublishedVersionId: '2' }, { id: '1' });
    expect(result.session.configVersionId).toBe('2');
    expect(result.version?.id).toBe('2');
    expect(mock.insert).toHaveBeenCalledTimes(1);
    expect(mock.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects a publication changed between package validation and the session lock', async () => {
    prefix(3n);
    await expect(startMirrorSession('1', '2', { ...input, expectedPublishedVersionId: '2' }, { id: '1' })).rejects.toThrow('MIRROR_PUBLISHED_VERSION_CHANGED');
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it('rejects a stale expected version without creating a session', async () => {
    prefix();
    await expect(startMirrorSession('1', '2', { ...input, expectedPublishedVersionId: '1' }, { id: '1' })).rejects.toThrow('MIRROR_PUBLISHED_VERSION_CHANGED');
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it('returns the original version on a legacy idempotent retry, never the latest beside an older session', async () => {
    prefix(); mock.rows.push([session(1n)], [context], [session(1n)], [version(1n)]);
    const result = await startMirrorSession('1', '2', input, { id: '1' });
    expect(result.session.configVersionId).toBe('1');
    expect(result.version?.id).toBe('1');
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it('rejects an idempotency key pinned to a different explicitly requested publication', async () => {
    prefix(); mock.rows.push([session(1n)]);
    await expect(startMirrorSession('1', '2', { ...input, expectedPublishedVersionId: '2' }, { id: '1' })).rejects.toThrow('MIRROR_PUBLISHED_VERSION_CHANGED');
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
