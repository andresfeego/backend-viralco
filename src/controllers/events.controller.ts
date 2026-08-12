import { jsonError } from '../lib/http.ts';
import { serviceErrorStatus } from '../lib/service-error.ts';
import {
  createEvent,
  createEventResource,
  deleteEventResource,
  getEventById,
  listEventResources,
  listEventsByAccount,
  listModes,
  updateEvent,
  updateEventBranding,
  updateEventResource,
} from '../services/events.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  jsonError(res, serviceErrorStatus(error), error instanceof Error ? error.message : fallback);
}

export async function getAccountEvents(req: any, res: any) {
  try { res.status(200).json({ events: await listEventsByAccount(req.params.accountId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo listar eventos'); }
}

export async function postAccountEvent(req: any, res: any) {
  try { res.status(201).json({ event: await createEvent(req.params.accountId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo crear evento'); }
}

export async function getTypes(_req: any, res: any) {
  try { res.status(200).json({ modes: await listModes(), types: await listModes() }); }
  catch (error) { sendError(res, error, 'No se pudo listar modos'); }
}

export async function getEvent(req: any, res: any) {
  try { res.status(200).json({ event: await getEventById(req.params.id, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo obtener evento'); }
}

export async function patchEvent(req: any, res: any) {
  try { res.status(200).json({ event: await updateEvent(req.params.id, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar evento'); }
}

export async function patchEventBranding(req: any, res: any) {
  try { res.status(200).json({ event: await updateEventBranding(req.params.id, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar branding'); }
}

export async function getResources(req: any, res: any) {
  try { res.status(200).json({ resources: await listEventResources(req.params.id, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudieron listar recursos'); }
}

export async function postResource(req: any, res: any) {
  try { res.status(201).json({ resource: await createEventResource(req.params.id, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo asignar recurso'); }
}

export async function patchResource(req: any, res: any) {
  try { res.status(200).json({ resource: await updateEventResource(req.params.id, req.params.resourceId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo actualizar recurso'); }
}

export async function deleteResource(req: any, res: any) {
  try { res.status(200).json(await deleteEventResource(req.params.id, req.params.resourceId, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo eliminar recurso'); }
}
