import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventsTable, modesTable, subscriptionModesTable, subscriptionPlansTable, subscriptionsTable } from '../db/schema.ts';
import { serializeId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';

const SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled', 'suspended']);
const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: 'Prueba activa',
  active: 'Activa',
  past_due: 'Pago pendiente',
  canceled: 'Cancelada',
  suspended: 'Suspendida',
};
const CONTRACTABLE_MODE_ORDER = ['espejo', 'cabina', 'video-360'];

function parseJsonField(value: any) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

export function mapPlan(row: any) {
  if (!row) return null;
  return {
    id: serializeId(row.id), slug: row.slug, name: row.name, description: row.description,
    limits: parseJsonField(row.limits), isActive: Boolean(row.isActive), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function mapSubscription(row: any, plan?: any) {
  if (!row) return null;
  return {
    id: serializeId(row.id), accountId: serializeId(row.accountId), planId: serializeId(row.planId),
    status: row.status, statusLabel: SUBSCRIPTION_STATUS_LABELS[row.status] || row.status,
    startsAt: row.startsAt, endsAt: row.endsAt, canceledAt: row.canceledAt,
    provider: row.provider, providerCustomerId: row.providerCustomerId, providerSubscriptionId: row.providerSubscriptionId,
    metadata: parseJsonField(row.metadata), plan: plan ? mapPlan(plan) : undefined, modes: row.modes || [],
    totalAmount: row.totalAmount ?? undefined, currency: row.currency ?? undefined,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function mapMode(row: any) {
  return {
    id: serializeId(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceAmount: Number(row.priceAmount || 0),
    priceCurrency: row.priceCurrency || 'USD',
    isDefault: Boolean(row.isDefault),
  };
}

async function getSubscriptionModes(subscriptionId: EntityId, tx: any = db) {
  const rows = await tx.select({ subscriptionMode: subscriptionModesTable, mode: modesTable })
    .from(subscriptionModesTable)
    .innerJoin(modesTable, eq(subscriptionModesTable.modeId, modesTable.id))
    .where(and(eq(subscriptionModesTable.subscriptionId, subscriptionId), eq(subscriptionModesTable.status, 'active')));
  return rows
    .map(({ subscriptionMode, mode }) => ({
      id: serializeId(subscriptionMode.id),
      mode: mapMode(mode),
      priceAmount: Number(subscriptionMode.priceAmount || 0),
      priceCurrency: subscriptionMode.priceCurrency || mode.priceCurrency || 'USD',
      status: subscriptionMode.status,
    }))
    .sort((a, b) => CONTRACTABLE_MODE_ORDER.indexOf(a.mode.slug) - CONTRACTABLE_MODE_ORDER.indexOf(b.mode.slug));
}

async function attachSubscriptionModes(subscription: any, plan?: any, tx: any = db) {
  if (!subscription) return null;
  const modes = await getSubscriptionModes(subscription.id, tx);
  const totalAmount = modes.reduce((sum, item) => sum + Number(item.priceAmount || 0), 0);
  const currency = modes[0]?.priceCurrency || 'USD';
  return mapSubscription({ ...subscription, modes, totalAmount, currency }, plan);
}

export async function findPlanBySlug(slug: string) {
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, slug)).limit(1);
  return plan || null;
}

export async function getLatestAccountSubscription(accountId: EntityId) {
  const [row] = await db
    .select({ subscription: subscriptionsTable, plan: subscriptionPlansTable })
    .from(subscriptionsTable)
    .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
    .where(eq(subscriptionsTable.accountId, accountId))
    .orderBy(desc(subscriptionsTable.startsAt), desc(subscriptionsTable.id))
    .limit(1);
  if (!row) return null;
  const mapped = await attachSubscriptionModes(row.subscription, row.plan);
  const { billingState } = await import('./billing.service.ts');
  const state = await billingState(accountId);
  if (state.system) return mapped;
  const status = state.administrativelyBlocked ? mapped.status : state.active ? 'active' : 'past_due';
  return { ...mapped, status, statusLabel: SUBSCRIPTION_STATUS_LABELS[status], endsAt: state.current?.endsAt || state.periods.at(-1)?.endsAt || null,
    modes: (state.current?.services || []).map((item: any) => ({ id: String(item.modeId), mode: { id: String(item.modeId), slug: item.slug, name: item.name }, priceAmount: Number(item.amountCop || 0), priceCurrency: 'COP', status: 'active' })),
    currency: 'COP', totalAmount: (state.current?.services || []).reduce((sum: number, item: any) => sum + Number(item.amountCop || 0), 0), billingNotice: state.notice };
}

export async function createAccountSubscription(input: { accountId: EntityId; planSlug?: string; modeSlugs?: string[]; status?: string; metadata?: any }, tx: any = db) {
  const plan = await findPlanBySlug(input.planSlug || 'suscripcion');
  if (!plan) throw new ServiceError(500, 'Plan de suscripcion no inicializado');
  const status = input.status || 'active';
  if (!SUBSCRIPTION_STATUSES.has(status)) throw new ServiceError(400, 'Estado de suscripcion invalido');
  const requestedModeSlugs = Array.isArray(input.modeSlugs) ? input.modeSlugs.map((value) => String(value).trim()).filter(Boolean) : [];
  const allModes = await tx.select().from(modesTable).orderBy(modesTable.id).for('update');
  const [archivedRows] = await tx.execute(sql`select mode_id from billing_catalog where archived_at is not null for update`);
  const archived = new Set((archivedRows as any[]).map(row => String(row.mode_id)));
  const defaultSlugs = allModes.filter((mode: any) => mode.isDefault && !archived.has(String(mode.id))).map((mode: any) => mode.slug);
  const selectedSlugs = requestedModeSlugs.length ? [...new Set(requestedModeSlugs)] : defaultSlugs;
  const modeBySlug = new Map(allModes.map((mode: any) => [mode.slug, mode]));
  const selectedModes = selectedSlugs.map((slug) => modeBySlug.get(slug));
  if (selectedModes.length === 0 || selectedModes.some((mode) => !mode)) throw new ServiceError(400, 'Servicio de suscripcion invalido');
  if (selectedModes.some((mode: any) => archived.has(String(mode.id)))) throw new ServiceError(409, 'Servicio archivado; actualiza el catalogo');
  const now = new Date();
  const result = await tx.insert(subscriptionsTable).values({
    accountId: input.accountId, planId: plan.id, status, startsAt: now, metadata: input.metadata || null, createdAt: now, updatedAt: now,
  });
  const subscriptionId = BigInt(result[0]?.insertId || 0);
  for (const mode of selectedModes as any[]) {
    await tx.insert(subscriptionModesTable).values({
      subscriptionId,
      modeId: mode.id,
      priceAmount: Number(mode.priceAmount || 0),
      priceCurrency: mode.priceCurrency || 'USD',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }
  const [subscription] = await tx.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, subscriptionId)).limit(1);
  return attachSubscriptionModes(subscription, plan, tx);
}

export async function assertSubscriptionIncludesModes(accountId: EntityId, modeSlugs: string[]) {
  const { assertBillingActive } = await import('./billing.service.ts');
  const state = await assertBillingActive(accountId);
  if (state.system) return;
  const contracted = new Set((state.current?.services || []).map((item: any) => item.slug));
  const missing = modeSlugs.filter((slug) => !contracted.has(slug));
  if (missing.length) throw new ServiceError(403, 'El evento incluye servicios no contratados por la cuenta');
}


export async function assertAccountCanCreateEvent(accountId: EntityId) {
  const { assertBillingActive } = await import('./billing.service.ts');
  await assertBillingActive(accountId);
  const [row] = await db
    .select({ subscription: subscriptionsTable, plan: subscriptionPlansTable })
    .from(subscriptionsTable)
    .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
    .where(eq(subscriptionsTable.accountId, accountId))
    .orderBy(desc(subscriptionsTable.startsAt), desc(subscriptionsTable.id))
    .limit(1);

  if (!row) {
    throw new ServiceError(403, 'La cuenta no tiene una suscripcion vigente');
  }

  const limits = parseJsonField(row.plan.limits) || {};
  const maxEvents = Number(limits.events);
  if (Number.isFinite(maxEvents) && maxEvents >= 0) {
    const existing = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(eq(eventsTable.accountId, accountId), ne(eventsTable.status, 'archived')));
    if (existing.length >= maxEvents) throw new ServiceError(403, 'La cuenta alcanzo el limite de eventos del plan');
  }

  return mapSubscription(row.subscription, row.plan);
}
