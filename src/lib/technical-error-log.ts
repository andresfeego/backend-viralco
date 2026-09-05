import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_DETAIL_LENGTH = 8000;
const LOG_DIRECTORY = process.env.TECHNICAL_LOG_DIRECTORY || path.join(process.cwd(), '.runtime-logs');
const LOG_FILE = path.join(LOG_DIRECTORY, 'backend-errors.jsonl');

function redact(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/(password|newPassword|refreshToken|accessToken|authorization|token)(["'\s:=]+)([^\s,"'}]+)/gi, '$1$2[redacted]')
    .slice(0, MAX_DETAIL_LENGTH);
}

function causeChain(error: unknown, depth = 0): string[] {
  if (depth > 3 || !error) return [];
  if (!(error instanceof Error)) return [String(error)];
  const current = `${error.name}: ${error.message}`;
  return [current, ...causeChain((error as Error & { cause?: unknown }).cause, depth + 1)];
}

export function technicalErrorDetail(error: unknown) {
  const parts = causeChain(error);
  if (error instanceof Error && error.stack) parts.push(error.stack);
  return redact(parts.filter(Boolean).join('\nCaused by: '));
}

export async function writeTechnicalErrorLog(input: {
  requestId: string;
  code: string;
  method?: string;
  path?: string;
  status: number;
  detail: string;
}) {
  if (process.env.NODE_ENV === 'test') return;
  await mkdir(LOG_DIRECTORY, { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    requestId: input.requestId,
    code: input.code,
    method: input.method || null,
    path: input.path || null,
    status: input.status,
    detail: redact(input.detail),
  };
  await appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function technicalLogPath() {
  return LOG_FILE;
}
