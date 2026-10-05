import { ServiceError } from '../lib/service-error.ts';

export function normalizePrintGuide(input: any) {
  const sourceUrl = String(input?.sourceUrl || '').trim();
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw new ServiceError(400, 'Enlace de manual invalido'); }
    if (url.protocol !== 'https:' || url.username || url.password || sourceUrl.length > 2048) throw new ServiceError(400, 'Enlace de manual invalido');
  }
  const steps = input?.steps;
  if (!Array.isArray(steps) || steps.length > 30 || steps.some((s: any) => typeof s !== 'string' || !s.trim() || s.length > 2000)) throw new ServiceError(400, 'Pasos de guia invalidos');
  const stepsByPlatform: Record<string, string[]> = {};
  for (const platform of ['ios', 'android']) {
    const extra = input?.stepsByPlatform?.[platform] || [];
    if (!Array.isArray(extra) || extra.length > 30 || extra.some((s: any) => typeof s !== 'string' || !s.trim() || s.length > 2000)) throw new ServiceError(400, 'Pasos de plataforma invalidos');
    stepsByPlatform[platform] = extra.map((s: string) => s.trim());
  }
  return { schemaVersion: 1, sourceUrl, steps: steps.map((s: string) => s.trim()), stepsByPlatform };
}

export function validateManual(file: any) {
  if (!file?.buffer || file.buffer.length > 25 * 1024 * 1024 || file.buffer.subarray(0, 5).toString() !== '%PDF-' || file.mimetype !== 'application/pdf') throw new ServiceError(400, 'Se requiere un PDF de hasta 25 MB');
}
