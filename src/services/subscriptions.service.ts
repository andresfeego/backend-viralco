import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventsTable, subscriptionPlansTable, subscriptionsTable } from '../db/schema.ts';
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
    metadata: parseJsonField(row.metadata), plan: plan ? mapPlan(plan) : undefined, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
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
  return row ? mapSubscription(row.subscription, row.plan) : null;
}

export async function createAccountSubscription(input: { accountId: EntityId; planSlug?: string; status?: string; metadata?: any }, tx: any = db) {
  const plan = await findPlanBySlug(input.planSlug || 'starter');
  if (!plan) throw new ServiceError(500, 'Plan de suscripcion no inicializado');
  const status = input.status || 'active';
  if (!SUBSCRIPTION_STATUSES.has(status)) throw new ServiceError(400, 'Estado de suscripcion invalido');
  const now = new Date();
  const result = await tx.insert(subscriptionsTable).values({
    accountId: input.accountId, planId: plan.id, status, startsAt: now, metadata: input.metadata || null, createdAt: now, updatedAt: now,
  });
  const subscriptionId = BigInt(result[0]?.insertId || 0);
  const [subscription] = await tx.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, subscriptionId)).limit(1);
  return mapSubscription(subscription, plan);
}


export async function assertAccountCanCreateEvent(accountId: EntityId) {
  const [row] = await db
    .select({ subscription: subscriptionsTable, plan: subscriptionPlansTable })
    .from(subscriptionsTable)
    .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
    .where(eq(subscriptionsTable.accountId, accountId))
    .orderBy(desc(subscriptionsTable.startsAt), desc(subscriptionsTable.id))
    .limit(1);

  if (!row || !['trialing', 'active'].includes(row.subscription.status)) {
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
