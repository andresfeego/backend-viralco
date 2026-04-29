export function jsonError(res: any, status: number, message: string, details?: any) {
  res.status(status).json({ error: message, details: details || undefined });
}

export function asyncHandler(handler: any) {
  return async (req: any, res: any, next: any) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}
