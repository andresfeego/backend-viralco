import { jsonError } from '../lib/http.ts';
import {
  createEvent,
  createEventOverlay,
  getEventById,
  listEventOverlays,
  listEvents,
  updateEvent,
  updateEventBranding,
  updateEventOverlay,
} from '../services/events.service.ts';

function badRequest(res: any, error: any, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  jsonError(res, 400, message);
}

export async function getEvents(_req: any, res: any) {
  try {
    const events = await listEvents();
    res.status(200).json({ events });
  } catch (error) {
    badRequest(res, error, 'No se pudo listar eventos');
  }
}

export async function getEvent(req: any, res: any) {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      jsonError(res, 400, 'ID de evento invalido');
      return;
    }
    const event = await getEventById(eventId);
    res.status(200).json({ event });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo obtener evento';
    const status = message.includes('no encontrado') ? 404 : 400;
    jsonError(res, status, message);
  }
}

export async function postEvent(req: any, res: any) {
  try {
    const event = await createEvent(req.body || {});
    res.status(201).json({ event });
  } catch (error) {
    badRequest(res, error, 'No se pudo crear evento');
  }
}

export async function patchEvent(req: any, res: any) {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      jsonError(res, 400, 'ID de evento invalido');
      return;
    }
    const event = await updateEvent(eventId, req.body || {});
    res.status(200).json({ event });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar evento';
    const status = message.includes('no encontrado') ? 404 : 400;
    jsonError(res, status, message);
  }
}

export async function patchEventBranding(req: any, res: any) {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      jsonError(res, 400, 'ID de evento invalido');
      return;
    }
    const event = await updateEventBranding(eventId, req.body || {});
    res.status(200).json({ event });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar branding';
    const status = message.includes('no encontrado') ? 404 : 400;
    jsonError(res, status, message);
  }
}

export async function getOverlays(req: any, res: any) {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      jsonError(res, 400, 'ID de evento invalido');
      return;
    }
    const overlays = await listEventOverlays(eventId);
    res.status(200).json({ overlays });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo listar overlays';
    const status = message.includes('no encontrado') ? 404 : 400;
    jsonError(res, status, message);
  }
}

export async function postOverlay(req: any, res: any) {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      jsonError(res, 400, 'ID de evento invalido');
      return;
    }
    const overlay = await createEventOverlay(eventId, req.body || {});
    res.status(201).json({ overlay });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear overlay';
    const status = message.includes('no encontrado') ? 404 : 400;
    jsonError(res, status, message);
  }
}

export async function patchOverlay(req: any, res: any) {
  try {
    const eventId = Number(req.params.id);
    const overlayId = Number(req.params.overlayId);
    if (!Number.isFinite(eventId) || !Number.isFinite(overlayId)) {
      jsonError(res, 400, 'IDs invalidos');
      return;
    }
    const overlay = await updateEventOverlay(eventId, overlayId, req.body || {});
    res.status(200).json({ overlay });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar overlay';
    const status = message.includes('no encontrado') ? 404 : 400;
    jsonError(res, status, message);
  }
}
