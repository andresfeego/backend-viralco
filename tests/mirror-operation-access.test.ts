import { beforeEach, expect, it, vi } from 'vitest';
import { ServiceError } from '../src/lib/service-error.ts';
const mock = vi.hoisted(() => ({ context: vi.fn(), select: vi.fn(), upload: vi.fn() }));
vi.mock('../src/services/magic-mirror.service.ts', () => ({ getMirrorContext: mock.context, mapSession: vi.fn() }));
vi.mock('../src/db/index.ts', () => ({ db: { select: mock.select } }));
vi.mock('../src/r2.ts', () => ({ assertRuntimeUploadInput: vi.fn(), buildMirrorRuntimeKey: vi.fn(), createPresignedReadUrl: vi.fn(), createPresignedRuntimeUpload: mock.upload, headR2Object: vi.fn(), r2PublicUrl: vi.fn() }));
import { createMirrorCaptureRun, prepareMirrorCapture, completeMirrorCapture, prepareMirrorAsset, completeMirrorAsset } from '../src/services/mirror-runtime.service.ts';
beforeEach(() => { vi.clearAllMocks(); mock.context.mockRejectedValue(new ServiceError(403, 'Revoked')); });
it.each([
  ['run', () => createMirrorCaptureRun('1', '2', '3', {}, { id: '4' })],
  ['capture', () => prepareMirrorCapture('1', '2', '3', '4', {}, { id: '4' })],
  ['capture-complete', () => completeMirrorCapture('1', '2', '3', '4', '5', { id: '4' })],
  ['composition', () => prepareMirrorAsset('1', '2', '3', '4', {}, { id: '4' })],
  ['composition-complete', () => completeMirrorAsset('1', '2', '3', '4', '5', { id: '4' })],
])('requires current capture.operate for %s before querying or preparing uploads', async (_name, operation) => {
  await expect((operation as () => Promise<any>)()).rejects.toMatchObject({ status: 403 });
  expect(mock.context).toHaveBeenCalledWith('1', '2', { id: '4' }, 'capture.operate');
  expect(mock.select).not.toHaveBeenCalled();
  expect(mock.upload).not.toHaveBeenCalled();
});
