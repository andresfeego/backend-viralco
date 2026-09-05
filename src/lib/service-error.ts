export class ServiceError extends Error {
  status: number;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

export function serviceErrorStatus(error: unknown, fallback = 500) {
  return error instanceof ServiceError ? error.status : fallback;
}
