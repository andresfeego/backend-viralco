import { getMirrorRecovery, setMirrorRecovery } from '../services/mirror-recovery.service.ts';
import { sendApiError } from '../lib/api-error.ts';

export async function getRecovery(req: any, res: any) {
  res.set('Cache-Control', 'no-store');
  try { res.json(await getMirrorRecovery(req.params.id, req.params.eventModeId, req.authUser)); }
  catch (error) { sendApiError(req, res, error, 'No se pudo consultar el acceso de recuperacion'); }
}
export async function putRecovery(req: any, res: any) {
  res.set('Cache-Control', 'no-store');
  try { res.json(await setMirrorRecovery(req.params.id, req.params.eventModeId, req.body?.pattern, req.authUser)); }
  catch (error) { sendApiError(req, res, error, 'No se pudo guardar el acceso de recuperacion'); }
}
