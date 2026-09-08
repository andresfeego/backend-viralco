import { sendApiError } from '../lib/api-error.ts';
import {
  completeMirrorAsset,
  completeMirrorCapture,
  createMirrorCaptureRun,
  getPublicMirrorAsset,
  getRuntimeSessionSummary,
  prepareMirrorAsset,
  prepareMirrorCapture,
  recordMirrorDelivery,
  updateMirrorCaptureRun,
} from '../services/mirror-runtime.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  sendApiError(res.req, res, error, fallback);
}

export async function postRun(req: any, res: any) {
  try { res.status(201).json({ run: await createMirrorCaptureRun(req.params.id, req.params.eventModeId, req.params.sessionId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo crear la experiencia'); }
}

export async function patchRun(req: any, res: any) {
  try { res.status(200).json({ run: await updateMirrorCaptureRun(req.params.id, req.params.eventModeId, req.params.sessionId, req.params.runId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar la experiencia'); }
}

export async function postCapture(req: any, res: any) {
  try { res.status(201).json(await prepareMirrorCapture(req.params.id, req.params.eventModeId, req.params.sessionId, req.params.runId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo preparar la toma'); }
}

export async function postCompleteCapture(req: any, res: any) {
  try { res.status(200).json({ capture: await completeMirrorCapture(req.params.id, req.params.eventModeId, req.params.sessionId, req.params.runId, req.params.captureId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo confirmar la toma'); }
}

export async function postAsset(req: any, res: any) {
  try { res.status(201).json(await prepareMirrorAsset(req.params.id, req.params.eventModeId, req.params.sessionId, req.params.runId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo preparar el entregable'); }
}

export async function postCompleteAsset(req: any, res: any) {
  try { res.status(200).json(await completeMirrorAsset(req.params.id, req.params.eventModeId, req.params.sessionId, req.params.runId, req.params.assetId, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo confirmar el entregable'); }
}

export async function getSessionSummary(req: any, res: any) {
  try { res.status(200).json(await getRuntimeSessionSummary(req.params.id, req.params.eventModeId, req.params.sessionId, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo consultar la sesion'); }
}

export async function getPublicAsset(req: any, res: any) {
  try {
    const method = ['qr', 'share', 'download'].includes(String(req.query?.method || '')) ? req.query.method : 'download';
    const payload = await recordMirrorDelivery(req.params.publicHash, method);
    if (!payload.ready || !payload.downloadUrl) return res.status(409).send('La foto todavía se está sincronizando');
    return res.redirect(302, payload.downloadUrl);
  }
  catch (error) { sendError(res, error, 'No se pudo obtener el entregable'); }
}

export async function postPublicDelivery(req: any, res: any) {
  try { res.status(200).json(await recordMirrorDelivery(req.params.publicHash, req.body?.method)); }
  catch (error) { sendError(res, error, 'No se pudo registrar la entrega'); }
}
