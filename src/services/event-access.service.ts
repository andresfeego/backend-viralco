import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { eventsTable, eventUsersTable, rolesTable } from '../db/schema.ts';
import { parseEntityId, type EntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { findAccountById, findAccountMembership, isSuperAdmin } from './account-access.service.ts';

const EVENT_PERMISSIONS: Record<string, string[]> = {
  admin: ['events.view', 'events.update', 'events.delete', 'events.resources.manage', 'events.members.manage', 'capture.operate'],
  operario: ['events.view', 'capture.operate'],
  cliente: ['events.view'],
};
export function eventRoleAllows(role: string, permission: string) {
  return ['owner', 'super_admin'].includes(role) || Boolean(EVENT_PERMISSIONS[role]?.includes(permission));
}
export async function eventRole(event: any, requester: any) {
  const account = await findAccountById(event.accountId);
  if (!account || account.status !== 'active') throw new ServiceError(403, 'Cuenta sin acceso activo');
  if (isSuperAdmin(requester)) return 'super_admin';
  const userId = parseEntityId(requester.id);
  const owner = await findAccountMembership(event.accountId, userId);
  if (owner?.membership.status === 'active' && owner.role.slug === 'owner') return 'owner';
  const [member] = await db.select({ role: rolesTable.slug }).from(eventUsersTable)
    .innerJoin(rolesTable, eq(rolesTable.id, eventUsersTable.roleId))
    .where(and(eq(eventUsersTable.eventId, event.id), eq(eventUsersTable.userId, userId), eq(eventUsersTable.status, 'active'))).limit(1);
  if (!member || !EVENT_PERMISSIONS[member.role]) throw new ServiceError(403, 'Sin acceso al evento');
  return member.role;
}
export async function assertEventAccess(eventId: EntityId, requester: any, mode: 'read' | 'write' = 'read', permission = mode === 'write' ? 'events.update' : 'events.view') {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId)).limit(1);
  if (!event) throw new ServiceError(404, 'Evento no encontrado');
  const role = await eventRole(event, requester);
  if (!eventRoleAllows(role, permission)) throw new ServiceError(403, 'Permiso de evento insuficiente');
  if (mode === 'write') {
    const { assertBillingActive } = await import('./billing.service.ts');
    await assertBillingActive(event.accountId);
  }
  return event;
}

// Context is supplied only by the event-library router, never by a body/header.
export async function assertLibraryAccountAccess(accountId: EntityId, requester: any, mode: 'read' | 'write', permission: string) {
  if (!requester.libraryEventId) {
    const { assertAccountAccess } = await import('./account-access.service.ts');
    return assertAccountAccess(accountId, requester, mode, permission);
  }
  const event = await assertEventAccess(parseEntityId(requester.libraryEventId), requester, mode, 'events.resources.manage');
  if (event.accountId !== accountId) throw new ServiceError(403, 'Biblioteca fuera del evento');
  return { account: await findAccountById(accountId), roleSlug: await eventRole(event, requester) };
}
