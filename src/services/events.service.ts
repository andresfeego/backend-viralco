import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventBrandingTable, eventModesTable, eventResourcesTable, eventsTable, eventTypesTable, libraryAssetsTable, modesTable } from '../db/schema.ts';
import { parseEntityId, serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { assertAccountAccess } from './account-access.service.ts';
import { assertAssetAvailableForEventAccount, getLibraryAssetWithVariants, mapLibraryAsset } from './library.service.ts';
import { assertAccountCanCreateEvent, assertSubscriptionIncludesModes } from './subscriptions.service.ts';

const EVENT_STATUS = new Set(['draft', 'active', 'archived']);
const RESOURCE_PURPOSES = new Set(['frame', 'overlay', 'intro', 'outro', 'music', 'logo', 'background', 'template', 'branding', 'other']);
const CONTRACTABLE_MODE_SLUGS = new Set(['espejo', 'cabina', 'video-360']);
const CONTRACTABLE_MODE_ORDER = ['espejo', 'cabina', 'video-360'];

function normalizeSlug(nameOrSlug: string) {
  return String(nameOrSlug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function assertDateOrNull(value: unknown, label: string) {
  const date = String(value || '').trim();
  if (!date) return null;
  if (!isIsoDate(date)) throw new ServiceError(400, `${label} invalida. Usa YYYY-MM-DD`);
  return date;
}

function assertTimezone(value: unknown) {
  const timezone = String(value || '').trim() || 'America/Bogota';
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$|^UTC$/.test(timezone)) throw new ServiceError(400, 'timezone invalido');
  return timezone;
}

function assertPositiveInt(value: unknown, label: string, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new ServiceError(400, `${label} invalido`);
  return number;
}

async function findEvent(eventId: EntityId) {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1);
  return event || null;
}

async function findEventTypeById(eventTypeId: EntityId) {
  const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.id, eventTypeId)).limit(1);
  return eventType || null;
}

async function assertEventAccess(eventId: EntityId, requester: any, mode: 'read' | 'write') {
  const event = await findEvent(eventId);
  if (!event) throw new ServiceError(404, 'Evento no encontrado');
  await assertAccountAccess(event.accountId, requester, mode, mode === 'write' ? 'events.update' : 'events.view');
  return event;
}

async function getBranding(eventId: EntityId) {
  const [branding] = await db.select().from(eventBrandingTable).where(eq(eventBrandingTable.eventId, eventId)).limit(1);
  return branding || null;
}

async function getEventModes(eventId: EntityId) {
  const rows = await db.select({ eventMode: eventModesTable, mode: modesTable })
    .from(eventModesTable)
    .innerJoin(modesTable, eq(eventModesTable.modeId, modesTable.id))
    .where(eq(eventModesTable.eventId, eventId))
    .orderBy(asc(eventModesTable.orderIndex), asc(modesTable.name));
  return rows.map(({ eventMode, mode }) => ({
    id: serializeId(eventMode.id), mode: { id: serializeId(mode.id), slug: mode.slug, name: mode.name, description: mode.description, priceAmount: mode.priceAmount, priceCurrency: mode.priceCurrency },
    isActive: Boolean(eventMode.isActive), orderIndex: eventMode.orderIndex, createdAt: eventMode.createdAt,
  }));
}

export async function mapEventResource(row: any, asset?: any) {
  return {
    id: serializeId(row.id), eventId: serializeId(row.eventId), libraryAssetId: serializeId(row.libraryAssetId),
    eventModeId: serializeId(row.eventModeId), purpose: row.purpose, placement: row.placement, config: row.config || null,
    orderIndex: row.orderIndex, isActive: Boolean(row.isActive), asset: asset ? await mapLibraryAsset(asset) : undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function mapEventResourceWithVariants(row: any, asset?: any) {
  const assetWithVariants = asset ? await getLibraryAssetWithVariants(asset.id) : null;
  return { ...await mapEventResource(row, asset), asset: assetWithVariants || (asset ? await mapLibraryAsset(asset) : undefined) };
}

async function getResourceById(resourceId: EntityId) {
  const [row] = await db.select({ resource: eventResourcesTable, asset: libraryAssetsTable })
    .from(eventResourcesTable)
    .innerJoin(libraryAssetsTable, eq(eventResourcesTable.libraryAssetId, libraryAssetsTable.id))
    .where(eq(eventResourcesTable.id, resourceId))
    .limit(1);
  return row || null;
}

async function mapBranding(branding: any) {
  if (!branding) return { id: null, logoResourceId: null, backgroundResourceId: null, logoResource: null, backgroundResource: null, isActive: true };
  const [logo, background] = await Promise.all([
    branding.logoResourceId ? getResourceById(branding.logoResourceId) : null,
    branding.backgroundResourceId ? getResourceById(branding.backgroundResourceId) : null,
  ]);
  return {
    id: serializeId(branding.id), logoResourceId: serializeId(branding.logoResourceId), backgroundResourceId: serializeId(branding.backgroundResourceId),
    logoResource: logo ? await mapEventResourceWithVariants(logo.resource, logo.asset) : null,
    backgroundResource: background ? await mapEventResourceWithVariants(background.resource, background.asset) : null,
    isActive: branding.isActive === undefined ? true : Boolean(branding.isActive),
  };
}

async function mapEventRow(row: any) {
  const [branding, modes, eventType] = await Promise.all([getBranding(row.id), getEventModes(row.id), findEventTypeById(row.eventTypeId)]);
  return {
    id: serializeId(row.id), accountId: serializeId(row.accountId), slug: row.slug, name: row.name,
    eventTypeId: serializeId(row.eventTypeId),
    eventType: eventType ? { id: serializeId(eventType.id), slug: eventType.slug, name: eventType.name, description: eventType.description } : null,
    description: row.description || '', startDate: row.startDate || null, endDate: row.endDate || null,
    eventDate: row.startDate || null, status: row.status, timezone: row.timezone, createdBy: serializeId(row.createdBy),
    branding: await mapBranding(branding), modes, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function listModes() {
  const rows = await db.select().from(modesTable).orderBy(asc(modesTable.name));
  return rows
    .filter((row) => CONTRACTABLE_MODE_SLUGS.has(row.slug))
    .sort((a, b) => CONTRACTABLE_MODE_ORDER.indexOf(a.slug) - CONTRACTABLE_MODE_ORDER.indexOf(b.slug))
    .map((row) => ({ id: serializeId(row.id), slug: row.slug, name: row.name, description: row.description, priceAmount: row.priceAmount, priceCurrency: row.priceCurrency, isDefault: Boolean(row.isDefault) }));
}

export async function listEventTypes() {
  const rows = await db.select().from(eventTypesTable).orderBy(asc(eventTypesTable.sortOrder), asc(eventTypesTable.name));
  return rows.map((row) => ({
    id: serializeId(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.isActive),
    sortOrder: row.sortOrder,
  }));
}

export async function listEventsByAccount(accountIdValue: unknown, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'read', 'events.view');
  const rows = await db.select().from(eventsTable).where(eq(eventsTable.accountId, accountId)).orderBy(asc(eventsTable.startDate), asc(eventsTable.id));
  return Promise.all(rows.map(mapEventRow));
}

export async function getEventById(eventIdValue: unknown, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const event = await assertEventAccess(eventId, requester, 'read');
  return mapEventRow(event);
}

async function assertUniqueSlug(accountId: EntityId, slug: string, skipEventId?: EntityId) {
  const [existing] = await db.select().from(eventsTable).where(and(eq(eventsTable.accountId, accountId), eq(eventsTable.slug, slug))).limit(1);
  if (!existing) return;
  if (skipEventId && existing.id === skipEventId) return;
  throw new ServiceError(409, 'Slug de evento ya existe');
}

async function uniqueSlugForAccount(accountId: EntityId, baseSlug: string, skipEventId?: EntityId) {
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const [existing] = await db.select().from(eventsTable).where(and(eq(eventsTable.accountId, accountId), eq(eventsTable.slug, candidate))).limit(1);
    if (!existing || (skipEventId && existing.id === skipEventId)) return candidate;
  }
  throw new ServiceError(409, 'No se pudo generar slug unico para el evento');
}

async function eventTypeFromInput(input: any, currentEventTypeId?: EntityId) {
  const rawId = input?.eventTypeId ?? input?.typeId;
  const rawSlug = String(input?.eventTypeSlug ?? input?.typeSlug ?? '').trim();
  if (!rawId && !rawSlug && currentEventTypeId) {
    const current = await findEventTypeById(currentEventTypeId);
    if (!current) throw new ServiceError(400, 'Tipo de evento invalido');
    return current;
  }
  if (rawId) {
    const eventType = await findEventTypeById(parseEntityId(rawId, 'ID de tipo de evento'));
    if (!eventType || !eventType.isActive) throw new ServiceError(400, 'Tipo de evento invalido');
    return eventType;
  }
  if (!rawSlug) throw new ServiceError(400, 'Tipo de evento es requerido');
  const [eventType] = await db.select().from(eventTypesTable).where(eq(eventTypesTable.slug, normalizeSlug(rawSlug))).limit(1);
  if (!eventType || !eventType.isActive) throw new ServiceError(400, 'Tipo de evento invalido');
  return eventType;
}

async function modeIdsFromInput(modeSlugsValue: unknown, options: { requireExplicit?: boolean } = {}) {
  const requested = Array.isArray(modeSlugsValue) ? modeSlugsValue.map((value) => String(value).trim()).filter(Boolean) : [];
  if (options.requireExplicit && requested.length === 0) throw new ServiceError(400, 'Selecciona al menos un modo de evento');
  const rows = await db.select().from(modesTable);
  const contractableRows = rows.filter((mode) => CONTRACTABLE_MODE_SLUGS.has(mode.slug));
  const defaults = contractableRows.filter((mode) => mode.isDefault).map((mode) => mode.slug);
  const slugs = requested.length ? requested : defaults;
  const modeBySlug = new Map(contractableRows.map((row) => [row.slug, row]));
  const modes = slugs.map((slug) => modeBySlug.get(slug));
  if (modes.some((mode) => !mode)) throw new ServiceError(400, 'Modo de evento invalido');
  return modes as any[];
}

export async function createEvent(accountIdValue: unknown, input: any, requester: any) {
  const accountId = parseEntityId(accountIdValue, 'ID de cuenta');
  await assertAccountAccess(accountId, requester, 'write', 'events.create');
  await assertAccountCanCreateEvent(accountId);
  const name = String(input?.name || '').trim();
  const eventType = await eventTypeFromInput(input);
  const startDate = assertDateOrNull(input?.startDate ?? input?.eventDate, 'startDate');
  const endDate = assertDateOrNull(input?.endDate, 'endDate');
  const status = String(input?.status || 'draft').trim();
  const description = String(input?.description || '').trim();
  const timezone = assertTimezone(input?.timezone);
  if (!name) throw new ServiceError(400, 'Nombre de evento es requerido');
  const slugDate = startDate || new Date().toISOString().slice(0, 10);
  const slugBase = normalizeSlug(`${eventType.slug}-${name}-${slugDate}`);
  const slug = await uniqueSlugForAccount(accountId, slugBase);
  if (!slug) throw new ServiceError(400, 'Slug invalido');
  if (!EVENT_STATUS.has(status)) throw new ServiceError(400, 'status invalido');
  const modes = await modeIdsFromInput(input?.modeSlugs, { requireExplicit: true });
  await assertSubscriptionIncludesModes(accountId, modes.map((mode) => mode.slug));
  const now = new Date();

  const eventId = await db.transaction(async (tx) => {
    const result = await tx.insert(eventsTable).values({ accountId, eventTypeId: eventType.id, slug, name, description: description || null, startDate, endDate, status, timezone, createdBy: parseEntityId(requester.id), createdAt: now, updatedAt: now });
    const insertedEventId = BigInt(result[0]?.insertId || 0);
    if (!insertedEventId) throw new ServiceError(500, 'No se pudo crear evento');
    await tx.insert(eventBrandingTable).values({ eventId: insertedEventId, createdAt: now, updatedAt: now });
    for (const [index, mode] of modes.entries()) await tx.insert(eventModesTable).values({ eventId: insertedEventId, modeId: mode.id, isActive: true, orderIndex: index, createdAt: now });
    return insertedEventId;
  });
  return getEventById(eventId, requester);
}

export async function updateEvent(eventIdValue: unknown, input: any, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const current = await assertEventAccess(eventId, requester, 'write');
  const nextName = String(input?.name ?? current.name).trim();
  const nextEventType = await eventTypeFromInput(input, current.eventTypeId);
  const nextStartDate = input?.startDate === undefined && input?.eventDate === undefined ? current.startDate : assertDateOrNull(input?.startDate ?? input?.eventDate, 'startDate');
  const nextEndDate = input?.endDate === undefined ? current.endDate : assertDateOrNull(input?.endDate, 'endDate');
  const nextStatus = String(input?.status ?? current.status).trim();
  const nextDescription = String(input?.description ?? current.description ?? '').trim();
  const nextTimezone = input?.timezone === undefined ? current.timezone : assertTimezone(input?.timezone);
  if (!nextName) throw new ServiceError(400, 'Nombre de evento es requerido');
  const regenerateSlug = nextName !== current.name || nextStartDate !== current.startDate || nextEventType.id !== current.eventTypeId;
  const slugDate = nextStartDate || new Date().toISOString().slice(0, 10);
  const nextSlug = regenerateSlug ? await uniqueSlugForAccount(current.accountId, normalizeSlug(`${nextEventType.slug}-${nextName}-${slugDate}`), eventId) : current.slug;
  if (!nextSlug) throw new ServiceError(400, 'Slug invalido');
  if (!EVENT_STATUS.has(nextStatus)) throw new ServiceError(400, 'status invalido');
  await assertUniqueSlug(current.accountId, nextSlug, eventId);
  const nextModes = input?.modeSlugs === undefined ? null : await modeIdsFromInput(input.modeSlugs, { requireExplicit: true });
  if (nextModes) await assertSubscriptionIncludesModes(current.accountId, nextModes.map((mode) => mode.slug));
  await db.transaction(async (tx) => {
    await tx.update(eventsTable).set({ eventTypeId: nextEventType.id, name: nextName, slug: nextSlug, startDate: nextStartDate, endDate: nextEndDate, status: nextStatus, description: nextDescription || null, timezone: nextTimezone, updatedAt: new Date() }).where(eq(eventsTable.id, eventId));
    if (nextModes) {
      await tx.delete(eventModesTable).where(eq(eventModesTable.eventId, eventId));
      for (const [index, mode] of nextModes.entries()) await tx.insert(eventModesTable).values({ eventId, modeId: mode.id, isActive: true, orderIndex: index, createdAt: new Date() });
    }
  });
  return getEventById(eventId, requester);
}

async function assertResourceBelongsToEvent(resourceId: EntityId, eventId: EntityId, purpose?: string) {
  const row = await getResourceById(resourceId);
  if (!row || row.resource.eventId !== eventId) throw new ServiceError(404, 'Recurso de evento no encontrado');
  if (purpose && row.resource.purpose !== purpose) throw new ServiceError(400, `El recurso debe tener proposito ${purpose}`);
  return row;
}

export async function updateEventBranding(eventIdValue: unknown, input: any, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  await assertEventAccess(eventId, requester, 'write');
  const patch: any = { updatedAt: new Date() };
  if (input?.logoResourceId !== undefined) {
    patch.logoResourceId = input.logoResourceId ? parseEntityId(input.logoResourceId, 'ID de logo') : null;
    if (patch.logoResourceId) await assertResourceBelongsToEvent(patch.logoResourceId, eventId, 'logo');
  }
  if (input?.backgroundResourceId !== undefined) {
    patch.backgroundResourceId = input.backgroundResourceId ? parseEntityId(input.backgroundResourceId, 'ID de fondo') : null;
    if (patch.backgroundResourceId) await assertResourceBelongsToEvent(patch.backgroundResourceId, eventId, 'background');
  }
  if (input?.isActive !== undefined) patch.isActive = Boolean(input.isActive);
  const existing = await getBranding(eventId);
  if (existing) await db.update(eventBrandingTable).set(patch).where(eq(eventBrandingTable.eventId, eventId));
  else await db.insert(eventBrandingTable).values({ eventId, ...patch, createdAt: new Date(), updatedAt: new Date() });
  return getEventById(eventId, requester);
}

export async function listEventResources(eventIdValue: unknown, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  await assertEventAccess(eventId, requester, 'read');
  const rows = await db.select({ resource: eventResourcesTable, asset: libraryAssetsTable })
    .from(eventResourcesTable)
    .innerJoin(libraryAssetsTable, eq(eventResourcesTable.libraryAssetId, libraryAssetsTable.id))
    .where(eq(eventResourcesTable.eventId, eventId))
    .orderBy(asc(eventResourcesTable.purpose), asc(eventResourcesTable.orderIndex), asc(eventResourcesTable.id));
  return Promise.all(rows.map((row) => mapEventResource(row.resource, row.asset)));
}

export async function createEventResource(eventIdValue: unknown, input: any, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const event = await assertEventAccess(eventId, requester, 'write');
  const libraryAssetId = parseEntityId(input?.libraryAssetId, 'ID de recurso');
  await assertAssetAvailableForEventAccount(libraryAssetId, event.accountId);
  const purpose = String(input?.purpose || '').trim();
  if (!RESOURCE_PURPOSES.has(purpose)) throw new ServiceError(400, 'Proposito de recurso invalido');
  const eventModeId = input?.eventModeId ? parseEntityId(input.eventModeId, 'ID de modo de evento') : null;
  if (eventModeId) {
    const [mode] = await db.select().from(eventModesTable).where(and(eq(eventModesTable.id, eventModeId), eq(eventModesTable.eventId, eventId))).limit(1);
    if (!mode) throw new ServiceError(404, 'Modo de evento no encontrado');
  }
  const now = new Date();
  const result = await db.insert(eventResourcesTable).values({
    eventId, libraryAssetId, eventModeId, purpose, placement: String(input?.placement || '').trim() || null,
    config: input?.config && typeof input.config === 'object' ? input.config : null,
    orderIndex: assertPositiveInt(input?.orderIndex, 'orderIndex'),
    isActive: input?.isActive === undefined ? true : Boolean(input.isActive), createdAt: now, updatedAt: now,
  });
  const resourceId = BigInt(result[0]?.insertId || 0);
  const row = await getResourceById(resourceId);
  return mapEventResource(row.resource, row.asset);
}

export async function updateEventResource(eventIdValue: unknown, resourceIdValue: unknown, input: any, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const resourceId = parseEntityId(resourceIdValue, 'ID de recurso de evento');
  await assertEventAccess(eventId, requester, 'write');
  const current = await assertResourceBelongsToEvent(resourceId, eventId);
  const patch: any = { updatedAt: new Date() };
  if (input?.purpose !== undefined) {
    patch.purpose = String(input.purpose || '').trim();
    if (!RESOURCE_PURPOSES.has(patch.purpose)) throw new ServiceError(400, 'Proposito de recurso invalido');
  }
  if (input?.placement !== undefined) patch.placement = String(input.placement || '').trim() || null;
  if (input?.config !== undefined) patch.config = input.config && typeof input.config === 'object' ? input.config : null;
  if (input?.orderIndex !== undefined) patch.orderIndex = assertPositiveInt(input.orderIndex, 'orderIndex');
  if (input?.isActive !== undefined) patch.isActive = Boolean(input.isActive);
  await db.update(eventResourcesTable).set(patch).where(eq(eventResourcesTable.id, current.resource.id));
  const row = await getResourceById(resourceId);
  return mapEventResource(row.resource, row.asset);
}

export async function deleteEventResource(eventIdValue: unknown, resourceIdValue: unknown, requester: any) {
  const eventId = parseEntityId(eventIdValue, 'ID de evento');
  const resourceId = parseEntityId(resourceIdValue, 'ID de recurso de evento');
  await assertEventAccess(eventId, requester, 'write');
  await assertResourceBelongsToEvent(resourceId, eventId);
  await db.delete(eventResourcesTable).where(eq(eventResourcesTable.id, resourceId));
  return { deleted: true };
}
