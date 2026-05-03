import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventOverlaysTable, eventsTable } from '../db/schema.ts';

const EVENT_STATUS = new Set(['draft', 'active', 'archived']);
const OVERLAY_TYPES = new Set(['frame', 'overlay', 'background', 'logo', 'other']);

function normalizeSlug(nameOrSlug: string) {
  return String(nameOrSlug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHttpUrl(value: string) {
  return /^https?:\/\/.+/i.test(String(value || ''));
}

function mapEventRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    eventDate: row.eventDate,
    status: row.status,
    description: row.description || '',
    phone: row.phone || '',
    branding: {
      logoUrl: row.logoUrl || '',
      backgroundUrl: row.backgroundUrl || '',
      primaryColor: row.primaryColor || '',
      secondaryColor: row.secondaryColor || '',
      textColor: row.textColor || '',
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapOverlayRow(row: any) {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    fileUrl: row.fileUrl,
    type: row.type,
    layerOrder: row.layerOrder,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listEvents() {
  const rows = await db.select().from(eventsTable).orderBy(asc(eventsTable.eventDate), asc(eventsTable.id));
  return rows.map(mapEventRow);
}

export async function getEventById(eventId: number) {
  const [row] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1);
  if (!row) {
    throw new Error('Evento no encontrado');
  }
  return mapEventRow(row);
}

async function assertUniqueSlug(slug: string, skipEventId?: number) {
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.slug, slug)).limit(1);
  if (!existing) {
    return;
  }
  if (skipEventId && Number(existing.id) === Number(skipEventId)) {
    return;
  }
  throw new Error('Slug de evento ya existe');
}

export async function createEvent(input: any) {
  const name = String(input?.name || '').trim();
  const slugInput = String(input?.slug || '').trim();
  const slug = normalizeSlug(slugInput || name);
  const eventDate = String(input?.eventDate || '').trim();
  const status = String(input?.status || 'draft').trim();
  const description = String(input?.description || '').trim();
  const phone = String(input?.phone || '').trim();

  if (!name) {
    throw new Error('Nombre de evento es requerido');
  }
  if (!slug) {
    throw new Error('Slug invalido');
  }
  if (!isIsoDate(eventDate)) {
    throw new Error('eventDate invalida. Usa YYYY-MM-DD');
  }
  if (!EVENT_STATUS.has(status)) {
    throw new Error('status invalido');
  }

  await assertUniqueSlug(slug);

  const now = new Date();
  const result = await db.insert(eventsTable).values({
    name,
    slug,
    eventDate,
    status: status as any,
    description: description || null,
    phone: phone || null,
    createdAt: now,
    updatedAt: now,
  });

  const eventId = Number(result[0]?.insertId || 0);
  if (!eventId) {
    throw new Error('No se pudo crear evento');
  }
  return getEventById(eventId);
}

export async function updateEvent(eventId: number, input: any) {
  const current = await getEventById(eventId);
  const nextName = String(input?.name ?? current.name).trim();
  const nextSlug = normalizeSlug(String(input?.slug ?? current.slug).trim() || nextName);
  const nextEventDate = String(input?.eventDate ?? current.eventDate).trim();
  const nextStatus = String(input?.status ?? current.status).trim();
  const nextDescription = String(input?.description ?? current.description).trim();
  const nextPhone = String(input?.phone ?? current.phone).trim();

  if (!nextName) {
    throw new Error('Nombre de evento es requerido');
  }
  if (!nextSlug) {
    throw new Error('Slug invalido');
  }
  if (!isIsoDate(nextEventDate)) {
    throw new Error('eventDate invalida. Usa YYYY-MM-DD');
  }
  if (!EVENT_STATUS.has(nextStatus)) {
    throw new Error('status invalido');
  }

  await assertUniqueSlug(nextSlug, eventId);

  await db
    .update(eventsTable)
    .set({
      name: nextName,
      slug: nextSlug,
      eventDate: nextEventDate,
      status: nextStatus as any,
      description: nextDescription || null,
      phone: nextPhone || null,
      updatedAt: new Date(),
    })
    .where(eq(eventsTable.id, eventId));

  return getEventById(eventId);
}

export async function updateEventBranding(eventId: number, input: any) {
  await getEventById(eventId);

  const logoUrl = String(input?.logoUrl || '').trim();
  const backgroundUrl = String(input?.backgroundUrl || '').trim();
  const primaryColor = String(input?.primaryColor || '').trim();
  const secondaryColor = String(input?.secondaryColor || '').trim();
  const textColor = String(input?.textColor || '').trim();

  if (logoUrl && !isHttpUrl(logoUrl)) {
    throw new Error('logoUrl invalida');
  }
  if (backgroundUrl && !isHttpUrl(backgroundUrl)) {
    throw new Error('backgroundUrl invalida');
  }

  await db
    .update(eventsTable)
    .set({
      logoUrl: logoUrl || null,
      backgroundUrl: backgroundUrl || null,
      primaryColor: primaryColor || null,
      secondaryColor: secondaryColor || null,
      textColor: textColor || null,
      updatedAt: new Date(),
    })
    .where(eq(eventsTable.id, eventId));

  return getEventById(eventId);
}

export async function listEventOverlays(eventId: number) {
  await getEventById(eventId);
  const rows = await db
    .select()
    .from(eventOverlaysTable)
    .where(eq(eventOverlaysTable.eventId, eventId))
    .orderBy(asc(eventOverlaysTable.layerOrder), asc(eventOverlaysTable.id));
  return rows.map(mapOverlayRow);
}

export async function createEventOverlay(eventId: number, input: any) {
  await getEventById(eventId);

  const name = String(input?.name || '').trim();
  const fileUrl = String(input?.fileUrl || '').trim();
  const type = String(input?.type || 'overlay').trim();
  const layerOrder = Number(input?.layerOrder ?? 0);
  const isActive = input?.isActive === undefined ? true : Boolean(input?.isActive);

  if (!name) {
    throw new Error('Nombre de overlay es requerido');
  }
  if (!fileUrl || !isHttpUrl(fileUrl)) {
    throw new Error('fileUrl invalida');
  }
  if (!OVERLAY_TYPES.has(type)) {
    throw new Error('type invalido');
  }
  if (!Number.isFinite(layerOrder)) {
    throw new Error('layerOrder invalido');
  }

  const now = new Date();
  const result = await db.insert(eventOverlaysTable).values({
    eventId,
    name,
    fileUrl,
    type: type as any,
    layerOrder,
    isActive,
    createdAt: now,
    updatedAt: now,
  });
  const overlayId = Number(result[0]?.insertId || 0);
  if (!overlayId) {
    throw new Error('No se pudo crear overlay');
  }
  const [row] = await db
    .select()
    .from(eventOverlaysTable)
    .where(and(eq(eventOverlaysTable.id, overlayId), eq(eventOverlaysTable.eventId, eventId)))
    .limit(1);
  return mapOverlayRow(row);
}

export async function updateEventOverlay(eventId: number, overlayId: number, input: any) {
  const [existing] = await db
    .select()
    .from(eventOverlaysTable)
    .where(and(eq(eventOverlaysTable.id, overlayId), eq(eventOverlaysTable.eventId, eventId)))
    .limit(1);
  if (!existing) {
    throw new Error('Overlay no encontrado');
  }

  const patch: Record<string, any> = { updatedAt: new Date() };
  if (input?.name !== undefined) {
    const name = String(input.name || '').trim();
    if (!name) {
      throw new Error('Nombre de overlay es requerido');
    }
    patch.name = name;
  }
  if (input?.fileUrl !== undefined) {
    const fileUrl = String(input.fileUrl || '').trim();
    if (!isHttpUrl(fileUrl)) {
      throw new Error('fileUrl invalida');
    }
    patch.fileUrl = fileUrl;
  }
  if (input?.type !== undefined) {
    const type = String(input.type || '').trim();
    if (!OVERLAY_TYPES.has(type)) {
      throw new Error('type invalido');
    }
    patch.type = type;
  }
  if (input?.layerOrder !== undefined) {
    const layerOrder = Number(input.layerOrder);
    if (!Number.isFinite(layerOrder)) {
      throw new Error('layerOrder invalido');
    }
    patch.layerOrder = layerOrder;
  }
  if (input?.isActive !== undefined) {
    patch.isActive = Boolean(input.isActive);
  }

  await db
    .update(eventOverlaysTable)
    .set(patch)
    .where(and(eq(eventOverlaysTable.id, overlayId), eq(eventOverlaysTable.eventId, eventId)));

  const [row] = await db
    .select()
    .from(eventOverlaysTable)
    .where(and(eq(eventOverlaysTable.id, overlayId), eq(eventOverlaysTable.eventId, eventId)))
    .limit(1);
  return mapOverlayRow(row);
}
