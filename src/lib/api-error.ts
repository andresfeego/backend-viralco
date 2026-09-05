import { ServiceError } from './service-error.ts';
import { technicalErrorDetail, writeTechnicalErrorLog } from './technical-error-log.ts';

type StructuredServiceError = { code?: string; message?: string; errors?: unknown; [key: string]: unknown };

function parseStructuredServiceError(error: ServiceError): StructuredServiceError | null {
  try {
    const parsed = JSON.parse(error.message);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function sendApiError(req: any, res: any, error: unknown, fallback: string) {
  const expected = error instanceof ServiceError;
  const structured = expected ? parseStructuredServiceError(error) : null;
  const status = expected ? error.status : 500;
  const code = String(structured?.code || (expected ? 'REQUEST_REJECTED' : 'INTERNAL_ERROR'));
  const publicMessage = expected
    ? String(structured?.code || structured?.message || error.message)
    : fallback;
  const requestId = String(req?.requestId || 'unknown');
  const detail = technicalErrorDetail(error);

  res.locals.apiError = { code, publicMessage, detail };
  void writeTechnicalErrorLog({
    requestId,
    code,
    method: req?.method,
    path: req?.originalUrl || req?.path,
    status,
    detail,
  }).catch((logError) => {
    console.error(`[technical-log][${requestId}] ${technicalErrorDetail(logError)}`);
  });

  if (!expected) console.error(`[api-error][${requestId}] ${detail}`);

  return res.status(status).json({
    error: publicMessage,
    code,
    details: structured || undefined,
    requestId,
  });
}
