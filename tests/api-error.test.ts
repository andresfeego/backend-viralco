import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendApiError } from '../src/lib/api-error.ts';
import { ServiceError } from '../src/lib/service-error.ts';
import { technicalErrorDetail } from '../src/lib/technical-error-log.ts';

function responseMock() {
  const response: any = {
    locals: {},
    statusCode: 0,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return response;
}

afterEach(() => vi.restoreAllMocks());

describe('safe API errors', () => {
  it('never returns an unexpected database error to the client', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = { requestId: 'request-1', method: 'POST', originalUrl: '/api/auth/login' };
    const res = responseMock();
    sendApiError(req, res, new Error('Failed query: select `id` from `users` where email = ?'), 'No se pudo iniciar sesion');
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(expect.objectContaining({ error: 'No se pudo iniciar sesion', code: 'INTERNAL_ERROR', requestId: 'request-1' }));
    expect(JSON.stringify(res.body)).not.toContain('select');
    expect(res.locals.apiError.detail).toContain('Failed query');
  });

  it('preserves safe service validation and structured conflict details', () => {
    const req = { requestId: 'request-2', method: 'PUT', originalUrl: '/api/events/1/modes/2/config' };
    const validation = responseMock();
    sendApiError(req, validation, new ServiceError(400, 'Correo invalido'), 'No se pudo guardar');
    expect(validation.body.error).toBe('Correo invalido');
    expect(validation.body.code).toBe('REQUEST_REJECTED');

    const conflict = responseMock();
    sendApiError(req, conflict, new ServiceError(409, JSON.stringify({ code: 'CONFIG_REVISION_CONFLICT', currentRevision: 4 })), 'No se pudo guardar');
    expect(conflict.body).toEqual(expect.objectContaining({ error: 'CONFIG_REVISION_CONFLICT', code: 'CONFIG_REVISION_CONFLICT', details: expect.objectContaining({ currentRevision: 4 }) }));
  });

  it('redacts authorization and token values from technical detail', () => {
    const detail = technicalErrorDetail(new Error('authorization: Bearer secret.value token=abcdef'));
    expect(detail).not.toContain('secret.value');
    expect(detail).not.toContain('abcdef');
    expect(detail).toContain('[redacted]');
  });
});
