export class ServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function serviceErrorStatus(error: unknown, fallback = 400) {
  return error instanceof ServiceError ? error.status : fallback;
}
