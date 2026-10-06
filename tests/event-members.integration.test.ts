import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/server.ts';
import { billingDb as db } from '../src/db/billing.ts';
import { createAccessToken } from '../src/services/token.service.ts';
import { buildAuthUser } from '../src/services/user.service.ts';
import { assertEventAccess, assertLibraryAccountAccess } from '../src/services/event-access.service.ts';
import { addEventMember, changeEventMember, listEventMembers } from '../src/services/event-members.service.ts';
import { getMirrorContext } from '../src/services/magic-mirror.service.ts';
import { issueOfflineAuthorization, verifyOfflineAuthorization } from '../src/services/offline-authorization.service.ts';
import { listAccounts } from '../src/services/accounts.service.ts';
import { getEventById, listEventAccounts, listEventsByAccount } from '../src/services/events.service.ts';
import { accountBilling } from '../src/services/billing.service.ts';

const run = process.env.RUN_BILLING_DB_TESTS === '1' ? describe : describe.skip;
run('email membership scoped strictly to events (isolated database)', () => {
  let owner: any, admin: any, operator: any, client: any, extra: any, inactive: any, legacy: any;
  let account: string, event: string, other: string, mode: string;
  const ids: string[] = [];
  const roles: Record<string, string> = {};
  const now = new Date();
  const bearer = (user: any) => `Bearer ${createAccessToken(user)}`;
  beforeAll(async () => {
    if (process.env.DB_NAME !== 'viralco_billing_test') throw new Error('Isolated billing database required');
    for (const slug of ['owner', 'admin', 'operario', 'cliente']) {
      await db('roles').insert({ slug, name: slug }).onConflict('slug').ignore();
      roles[slug] = String((await db('roles').where({ slug }).first()).id);
    }
    const status = await db('user_statuses').where({ slug: 'active' }).first();
    const suspended = await db('user_statuses').where({ slug: 'suspended' }).first();
    const user = async (label: string, statusId = status.id) => {
      const email = randomUUID() + '@members.test';
      const [id] = await db('users').insert({ email, password: randomUUID(), name: label, status_id: statusId, created_at: now, updated_at: now });
      ids.push(String(id)); return { id: String(id), email, globalRoles: [] };
    };
    owner = await user('Owner'); admin = await user('Admin'); operator = await user('Operator'); client = await user('Client');
    extra = await user('Extra'); inactive = await user('Inactive', suspended.id); legacy = await user('Legacy account member');
    const [accountId] = await db('accounts').insert({ name: 'Event access test', slug: randomUUID(), owner_user_id: owner.id, is_system: true, status: 'active', created_at: now, updated_at: now });
    account = String(accountId);
    await db('account_users').insert([{ account_id: account, user_id: owner.id, role_id: roles.owner, status: 'active', created_at: now, updated_at: now }, { account_id: account, user_id: legacy.id, role_id: roles.admin, status: 'active', created_at: now, updated_at: now }]);
    const type = await db('event_types').first();
    const createEvent = async () => String((await db('events').insert({ account_id: account, event_type_id: type.id, slug: randomUUID(), name: 'Assigned event', status: 'active', timezone: 'America/Bogota', created_by: owner.id, created_at: now, updated_at: now }))[0]);
    event = await createEvent(); other = await createEvent();
    const mirror = await db('modes').where({ slug: 'espejo' }).first();
    mode = String((await db('event_modes').insert({ event_id: event, mode_id: mirror.id, is_active: true, created_at: now }))[0]);
  });
  afterAll(async () => {
    if (account) {
      await db('event_users').whereIn('event_id', [event, other]).delete();
      await db('event_modes').where({ id: mode }).delete();
      await db('events').whereIn('id', [event, other]).delete();
      await db('account_users').where({ account_id: account }).delete();
      await db('accounts').where({ id: account }).delete();
    }
    if (ids.length) await db('users').whereIn('id', ids).delete();
    await db.destroy();
  });
  it('normalizes email and requires an existing active registered profile', async () => {
    const endpoint = `/api/events/${event}/members`;
    const missing = await request(app).post(endpoint).set('Authorization', bearer(owner)).send({ email: `${randomUUID()}@unknown.test`, roleSlug: 'operario' });
    expect(missing.status).toBe(404); expect(missing.body.code).toBe('EVENT_MEMBER_REGISTER_FIRST');
    await expect(addEventMember(event, { email: 'bad', roleSlug: 'admin' }, owner)).rejects.toThrow('EVENT_MEMBER_EMAIL_INVALID');
    await expect(addEventMember(event, { email: inactive.email, roleSlug: 'admin' }, owner)).rejects.toThrow('EVENT_MEMBER_INACTIVE');
    for (const [user, roleSlug] of [[admin, 'admin'], [operator, 'operario'], [client, 'cliente']] as const) {
      const response = await request(app).post(endpoint).set('Authorization', bearer(owner)).send({ email: `  ${user.email.toUpperCase()}  `, roleSlug });
      expect(response.status).toBe(201);
      expect(response.body.members).toContainEqual(expect.objectContaining({ user: expect.objectContaining({ email: user.email }), role: { slug: roleSlug } }));
    }
    await expect(addEventMember(event, { email: owner.email, roleSlug: 'admin' }, admin)).rejects.toThrow('EVENT_MEMBER_ALREADY_HAS_ACCESS');
    await expect(addEventMember(event, { email: extra.email, roleSlug: 'owner' }, admin)).rejects.toThrow('EVENT_MEMBER_ROLE_INVALID');
    expect(await db('account_users').where({ user_id: admin.id })).toHaveLength(0);
  });
  it('discovers assigned events without owning a paid account and isolates every other event', async () => {
    expect(await listAccounts(operator)).toEqual([]);
    expect(await listEventAccounts(operator)).toEqual([expect.objectContaining({ id: account, eventAssignmentOnly: true })]);
    expect((await listEventsByAccount(account, operator)).map(row => row.id)).toEqual([event]);
    expect((await getEventById(event, operator)).access.roleSlug).toBe('operario');
    await expect(getEventById(other, operator)).rejects.toMatchObject({ status: 403 });
    expect((await buildAuthUser(BigInt(operator.id)))?.events).toEqual([{ eventId: event, accountId: account, roleSlug: 'operario' }]);
    expect((await buildAuthUser(BigInt(operator.id)))?.accounts).toEqual([]);
    const response = await request(app).get('/api/events/accounts').set('Authorization', bearer(operator));
    expect(response.status).toBe(200); expect(response.body.accounts[0].id).toBe(account);
  });
  it('authorizes admin editing, operator capture and client read-only without account/billing authority', async () => {
    await expect(assertEventAccess(BigInt(event), admin, 'write', 'events.update')).resolves.toBeTruthy();
    await expect(assertLibraryAccountAccess(BigInt(account), { ...admin, libraryEventId: event }, 'write', 'events.resources.manage')).resolves.toBeTruthy();
    await expect(assertLibraryAccountAccess(BigInt(account), admin, 'read', 'events.resources.manage')).rejects.toMatchObject({ status: 403 });
    for (const user of [admin, operator, client]) await expect(accountBilling(account, user)).rejects.toMatchObject({ status: 403 });
    for (const user of [operator, client]) await expect(assertEventAccess(BigInt(event), user, 'write', 'events.update')).rejects.toMatchObject({ status: 403 });
    for (const user of [owner, admin, operator]) await expect(getMirrorContext(event, mode, user, 'capture.operate')).resolves.toBeTruthy();
    await expect(getMirrorContext(event, mode, client, 'capture.operate')).rejects.toMatchObject({ status: 403 });
    await expect(listEventMembers(event, operator)).rejects.toMatchObject({ status: 403 });
    const context = await getMirrorContext(event, mode, operator, 'capture.operate');
    const grant = verifyOfflineAuthorization(await issueOfflineAuthorization(context, operator, 'test-phone'));
    expect(grant).toMatchObject({ v: 3, userId: operator.id, eventId: event, accountId: account });
  });
  it('scopes library access to the event and does not trust a client-supplied scope', async () => {
    const read = (user: any, path: string) => request(app).get(path).set('Authorization', bearer(user));
    expect((await read(admin, `/api/events/${event}/library?scope=available`)).status).toBe(200);
    expect((await read(admin, `/api/events/${other}/library?libraryEventId=${event}`)).status).toBe(403);
    expect((await read(admin, `/api/accounts/${account}/library?libraryEventId=${event}`)).status).toBe(403);
    expect((await read(operator, `/api/events/${event}/library`)).status).toBe(403);
  });
  it('serializes duplicate additions and prevents self-removal or cross-event member IDs', async () => {
    const results = await Promise.allSettled([addEventMember(event, { email: extra.email, roleSlug: 'operario' }, admin), addEventMember(event, { email: extra.email, roleSlug: 'operario' }, admin)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('EVENT_MEMBER_EXISTS');
    const members = await listEventMembers(event, owner);
    const self = members.find(member => member.user.id === admin.id)!;
    await expect(changeEventMember(event, self.id, {}, admin, true)).rejects.toThrow('EVENT_MEMBER_SELF_CHANGE');
    await expect(changeEventMember(other, self.id, {}, owner, true)).rejects.toThrow('EVENT_MEMBER_NOT_FOUND');
  });
  it('revokes capture/synchronization authorization immediately on suspension or removal without removing the user/event', async () => {
    const member = (await listEventMembers(event, owner)).find(row => row.user.id === operator.id)!;
    await changeEventMember(event, member.id, { status: 'suspended' }, admin);
    await expect(getMirrorContext(event, mode, operator, 'capture.operate')).rejects.toMatchObject({ status: 403 });
    expect(await listEventAccounts(operator)).toEqual([]);
    await changeEventMember(event, member.id, { status: 'active', roleSlug: 'cliente' }, admin);
    await expect(getMirrorContext(event, mode, operator, 'capture.operate')).rejects.toMatchObject({ status: 403 });
    await expect(getEventById(event, operator)).resolves.toBeTruthy();
    await changeEventMember(event, member.id, {}, owner, true);
    await expect(getEventById(event, operator)).rejects.toMatchObject({ status: 403 });
    expect(await db('users').where({ id: operator.id }).first()).toBeTruthy();
    expect(await db('events').where({ id: event }).first()).toBeTruthy();
  });
  it('rejects retired account-membership routes and any leftover account-admin authorization', async () => {
    expect(await listAccounts(legacy)).toEqual([]);
    expect(await listEventsByAccount(account, legacy)).toEqual([]);
    await expect(getEventById(event, legacy)).rejects.toMatchObject({ status: 403 });
    await expect(accountBilling(account, legacy)).rejects.toMatchObject({ status: 403 });
    const response = await request(app).post(`/api/accounts/${account}/members`).set('Authorization', bearer(owner)).send({ userId: extra.id, roleSlug: 'admin' });
    expect(response.status).toBe(410);
  });
});
