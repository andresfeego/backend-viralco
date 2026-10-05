import { beforeEach, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('../src/services/magic-mirror.service.ts', () => ({ getMirrorContext: mocks.context }));
vi.mock('../src/db/index.ts', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: mocks.read }) }) }),
  insert: () => ({ values: (values: any) => ({ onDuplicateKeyUpdate: () => mocks.write(values) }) }),
} }));
import { getMirrorRecovery, setMirrorRecovery } from '../src/services/mirror-recovery.service.ts';
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ eventModeId: 2n }); mocks.read.mockResolvedValue([]); });

it('stores only a salted verifier independently of draft/publication', async () => {
  await setMirrorRecovery('1', '2', [0, 1, 2, 5], { id: '3' });
  expect(mocks.context).toHaveBeenCalledWith('1', '2', { id: '3' }, 'events.update');
  const row = mocks.write.mock.calls[0][0];
  expect(row.eventModeId).toBe(2n);
  expect(row.pattern).toBeUndefined();
  expect(await bcrypt.compare('0-1-2-5', row.verifier)).toBe(true);
  expect(await bcrypt.compare('0-1-2-8', row.verifier)).toBe(false);
});
it('does not write when account authorization fails', async () => {
  mocks.context.mockRejectedValue(new Error('Forbidden'));
  await expect(setMirrorRecovery('1', '2', [0, 1, 2, 5], { id: '3' })).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled();
});
it.each([[0, 1, 2], [0, 0, 1, 2], [0, 1, 2, 9], ['0', 1, 2, 5]])('rejects malformed pattern %j', async (...pattern) => {
  await expect(setMirrorRecovery('1', '2', pattern, { id: '3' })).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled();
});
it('requires capture access for fetching the offline verifier', async () => {
  expect(await getMirrorRecovery('1', '2', { id: '3' })).toEqual({ verifier: null, updatedAt: null });
  expect(mocks.context).toHaveBeenCalledWith('1', '2', { id: '3' }, 'capture.operate');
});
