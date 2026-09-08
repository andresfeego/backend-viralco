import { sendApiError } from '../lib/api-error.ts';
import {
  endMirrorSession,
  forceEndMirrorSession,
  getActiveMirrorSession,
  getMirrorConfig,
  getMirrorSessionPackage,
  getPublishedMirrorConfig,
  publishMirrorConfig,
  saveMirrorConfig,
  startMirrorSession,
  updateMirrorSession,
  validateMirrorConfig,
} from '../services/magic-mirror.service.ts';
import { applyPhotoLayoutTemplate } from '../services/photo-layout-template.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  sendApiError(res.req, res, error, fallback);
}

export async function getConfig(req: any, res: any) {
  try { res.status(200).json({ config: await getMirrorConfig(req.params.id, req.params.eventModeId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo obtener configuracion'); }
}

export async function putConfig(req: any, res: any) {
  try { res.status(200).json({ config: await saveMirrorConfig(req.params.id, req.params.eventModeId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo guardar configuracion'); }
}

export async function postValidate(req: any, res: any) {
  try { res.status(200).json(await validateMirrorConfig(req.params.id, req.params.eventModeId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo validar configuracion'); }
}

export async function postPublish(req: any, res: any) {
  try { res.status(201).json(await publishMirrorConfig(req.params.id, req.params.eventModeId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo publicar configuracion'); }
}

export async function postApplyLayoutTemplate(req: any, res: any) {
  try { res.status(200).json(await applyPhotoLayoutTemplate(req.params.id, req.params.eventModeId, req.params.assetId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo aplicar plantilla'); }
}

export async function getPublished(req: any, res: any) {
  try { res.status(200).json(await getPublishedMirrorConfig(req.params.id, req.params.eventModeId, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo obtener publicacion'); }
}

export async function postSession(req: any, res: any) {
  try { res.status(201).json(await startMirrorSession(req.params.id, req.params.eventModeId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo iniciar sesion'); }
}

export async function patchSession(req: any, res: any) {
  try { res.status(200).json({ session: await updateMirrorSession(req.params.id, req.params.eventModeId, req.params.sessionId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar sesion'); }
}

export async function postEndSession(req: any, res: any) {
  try { res.status(200).json({ session: await endMirrorSession(req.params.id, req.params.eventModeId, req.params.sessionId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo finalizar sesion'); }
}

export async function getActiveSession(req: any, res: any) {
  try { res.status(200).json(await getActiveMirrorSession(req.params.id, req.params.eventModeId, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo recuperar la sesion'); }
}

export async function getSessionPackage(req: any, res: any) {
  try { res.status(200).json(await getMirrorSessionPackage(req.params.id, req.params.eventModeId, req.params.sessionId, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo preparar el paquete del evento'); }
}

export async function postForceEndSession(req: any, res: any) {
  try { res.status(200).json({ session: await forceEndMirrorSession(req.params.id, req.params.eventModeId, req.params.sessionId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo forzar el cierre de la sesion'); }
}
