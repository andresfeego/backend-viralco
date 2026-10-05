import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ row: { id: 1n, type: 'print_profile', status: 'active', storageKey: 'viralco/library/print_profile/canon/profile.json', metadata: {} as any }, update: vi.fn(), put: vi.fn() }));
vi.mock('../src/db/index.ts', () => ({ db: { transaction: async (fn: any) => fn({
  select: () => ({ from: () => ({ where: () => ({ for: async () => [mocks.row] }) }) }),
  update: () => ({ set: (value: any) => ({ where: async () => mocks.update(value) }) }),
}) } }));
vi.mock('../src/r2.ts', () => ({ putR2Object: mocks.put, r2PublicUrl: (key: string) => `https://media.test/${key}`, createPresignedReadUrl: async (key: string) => `https://signed.test/${key}` }));
import { savePrintGuide } from '../src/services/print-guide.service.ts';
const admin = { globalRoles: [{ slug: 'super_admin' }] };
beforeEach(() => { vi.clearAllMocks(); mocks.row.metadata = { unrelated: 'preserved' }; });
it('allows only superadmin publication', async () => {
  await expect(savePrintGuide('1', { steps: [] }, null, {})).rejects.toThrow();
  expect(mocks.put).not.toHaveBeenCalled();
});
it('publishes optional-PDF guides without touching print geometry', async () => {
  const result = await savePrintGuide('1', { steps: ['Connect'] }, null, admin);
  expect(result.steps).toEqual(['Connect']);
  expect(result.manual).toBeNull();
  expect(mocks.update.mock.calls[0][0].metadata.unrelated).toBe('preserved');
  expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('storageKey');
});
it('retains previous PDF and rejects stale edits', async () => {
  mocks.row.metadata.printGuide = { revision: 'r1', manual: { key: 'manual.pdf', sha256: 'a'.repeat(64) } };
  await expect(savePrintGuide('1', { steps: [], revision: 'r0' }, null, admin)).rejects.toThrow();
  expect(mocks.put).not.toHaveBeenCalled();
  const result = await savePrintGuide('1', { steps: ['Updated'], revision: 'r1' }, null, admin);
  expect(result.manual?.key).toBe('manual.pdf');
});
it('uploads a content-addressed PDF and returns a signed URL', async () => {
  const result = await savePrintGuide('1', { steps: [] }, { mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') }, admin);
  expect(result.manual?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.manual?.url).toMatch(/^https:\/\/signed.test/);
  expect(mocks.put).toHaveBeenCalledTimes(2);
});
