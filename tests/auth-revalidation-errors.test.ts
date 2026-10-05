import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ verify: vi.fn(), user: vi.fn(), jsonError: vi.fn(), serverError: vi.fn() }));
vi.mock('../src/services/token.service.ts', () => ({ verifyAccessToken: mock.verify }));
vi.mock('../src/services/user.service.ts', () => ({ buildAuthUser: mock.user }));
vi.mock('../src/lib/http.ts', () => ({ jsonError: mock.jsonError }));
vi.mock('../src/lib/api-error.ts', () => ({ sendApiError: mock.serverError }));
import { requireAuth } from '../src/middlewares/require-auth.ts';
beforeEach(() => { vi.clearAllMocks(); mock.verify.mockReturnValue({ tipo: 'access', sub: '1' }); });
it('does not report revoked credentials when the user database is temporarily unavailable', async () => {
  mock.user.mockRejectedValue(new Error('database unavailable'));
  const next = vi.fn();
  await requireAuth({ headers: { authorization: 'Bearer valid' } }, {}, next);
  expect(mock.serverError).toHaveBeenCalledTimes(1);
  expect(mock.jsonError).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
it('still rejects an invalid token without querying user data', async () => {
  mock.verify.mockImplementation(() => { throw new Error('expired'); });
  const response = {};
  await requireAuth({ headers: { authorization: 'Bearer invalid' } }, response, vi.fn());
  expect(mock.jsonError).toHaveBeenCalledWith(response, 401, expect.any(String));
  expect(mock.user).not.toHaveBeenCalled();
});
