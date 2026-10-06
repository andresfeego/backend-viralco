import { billingDb } from '../db/billing.ts';
import { parseEntityId } from '../lib/ids.ts';
import { ServiceError } from '../lib/service-error.ts';
import { assertEventAccess } from './event-access.service.ts';

const roles = new Set(['admin', 'operario', 'cliente']);
const fail = (status: number, code: string) => new ServiceError(status, JSON.stringify({ code }));
export async function listEventMembers(eventIdValue: unknown, requester: any) {
  const eventId = parseEntityId(eventIdValue);
  await assertEventAccess(eventId, requester, 'read', 'events.members.manage');
  const rows = await billingDb('event_users as eu').join('users as u', 'u.id', 'eu.user_id').join('roles as r', 'r.id', 'eu.role_id')
    .where('eu.event_id', String(eventId)).select('eu.id', 'eu.status', 'u.id as userId', 'u.name', 'u.email', 'r.slug as roleSlug').orderBy('u.name');
  return rows.map(row => ({ id: String(row.id), status: row.status, user: { id: String(row.userId), name: row.name, email: row.email }, role: { slug: row.roleSlug } }));
}
export async function addEventMember(eventIdValue: unknown, input: any, requester: any) {
  const eventId = parseEntityId(eventIdValue);
  await assertEventAccess(eventId, requester, 'write', 'events.members.manage');
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'EVENT_MEMBER_EMAIL_INVALID');
  if (!roles.has(input.roleSlug)) throw fail(400, 'EVENT_MEMBER_ROLE_INVALID');
  await billingDb.transaction(async tx => {
    const event = await tx('events').where({ id: String(eventId) }).forUpdate().first();
    await assertEventAccess(eventId, requester, 'write', 'events.members.manage');
    const user = await tx('users as u').join('user_statuses as s', 's.id', 'u.status_id').whereRaw('LOWER(u.email) = ?', [email]).select('u.id', 's.slug as status').first();
    if (!user) throw fail(404, 'EVENT_MEMBER_REGISTER_FIRST');
    if (user.status !== 'active') throw fail(409, 'EVENT_MEMBER_INACTIVE');
    const owner = await tx('account_users as au').join('roles as r', 'r.id', 'au.role_id')
      .where({ 'au.account_id': event.account_id, 'au.user_id': user.id, 'r.slug': 'owner' }).first();
    if (owner || String(user.id) === String(requester.id)) throw fail(409, 'EVENT_MEMBER_ALREADY_HAS_ACCESS');
    if (await tx('event_users').where({ event_id: String(eventId), user_id: user.id }).first()) throw fail(409, 'EVENT_MEMBER_EXISTS');
    const role = await tx('roles').where({ slug: input.roleSlug }).first();
    if (!role) throw fail(400, 'EVENT_MEMBER_ROLE_INVALID');
    await tx('event_users').insert({ event_id: String(eventId), user_id: user.id, role_id: role.id, status: 'active', created_at: new Date(), updated_at: new Date() });
  });
  return listEventMembers(eventId, requester);
}
export async function changeEventMember(eventIdValue: unknown, memberIdValue: unknown, input: any, requester: any, remove = false) {
  const eventId = parseEntityId(eventIdValue), memberId = parseEntityId(memberIdValue);
  await assertEventAccess(eventId, requester, 'write', 'events.members.manage');
  await billingDb.transaction(async tx => {
    await tx('events').where({ id: String(eventId) }).forUpdate().first();
    await assertEventAccess(eventId, requester, 'write', 'events.members.manage');
    const where = { id: String(memberId), event_id: String(eventId) };
    const member = await tx('event_users').where(where).first();
    if (!member) throw fail(404, 'EVENT_MEMBER_NOT_FOUND');
    // Avoid removing the caller's own management access through a stale screen.
    if (String(member.user_id) === String(requester.id)) throw fail(409, 'EVENT_MEMBER_SELF_CHANGE');
    if (remove) { await tx('event_users').where(where).delete(); return; }
    const patch: any = { updated_at: new Date() };
    if (input.roleSlug !== undefined) {
      if (!roles.has(input.roleSlug)) throw fail(400, 'EVENT_MEMBER_ROLE_INVALID');
      const role = await tx('roles').where({ slug: input.roleSlug }).first();
      if (!role) throw fail(400, 'EVENT_MEMBER_ROLE_INVALID');
      patch.role_id = role.id;
    }
    if (input.status !== undefined) {
      if (!['active', 'suspended'].includes(input.status)) throw fail(400, 'EVENT_MEMBER_STATUS_INVALID');
      patch.status = input.status;
    }
    await tx('event_users').where(where).update(patch);
  });
  return listEventMembers(eventId, requester);
}
