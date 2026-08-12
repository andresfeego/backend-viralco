import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/server.ts';
import { db } from '../src/db/index.ts';
import { accountLibraryTable, accountsTable, accountUsersTable, eventBrandingTable, eventModesTable, eventResourcesTable, eventsTable, libraryAssetsTable, passwordResetTokensTable, refreshTokensTable, subscriptionsTable, userRolesTable, usersTable } from '../src/db/schema.ts';
import { assignGlobalRoleToUser, createUser, findRoleBySlug, findUserByEmail, updateUserStatus } from '../src/services/user.service.ts';
import { hashPassword } from '../src/services/crypto.service.ts';

const run = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

run('auth and accounts integration', () => {
  let ownerLogin: any;
  let superLogin: any;
  let accountId: string;
  beforeAll(async () => {
    await db.delete(eventBrandingTable);
    await db.delete(eventResourcesTable);
    await db.delete(eventModesTable);
    await db.delete(eventsTable);
    await db.delete(accountLibraryTable);
    await db.delete(libraryAssetsTable);
    await db.delete(subscriptionsTable);
    await db.delete(accountUsersTable);
    await db.delete(accountsTable);
    await db.delete(refreshTokensTable);
    await db.delete(passwordResetTokensTable);
    await db.delete(userRolesTable);
    await db.delete(usersTable);
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('registers pending, blocks login, activates and serializes bigint ids', async () => {
    const registration = await request(app).post('/api/auth/register').send({
      email: 'owner@test.local', password: 'Password_123!', name: 'Owner Test', phone: null,
    });
    expect(registration.status).toBe(201);
    expect(registration.body.user.status.slug).toBe('pending');
    expect(typeof registration.body.user.id).toBe('string');
    expect(registration.body.user.globalRoles).toEqual([]);

    const blocked = await request(app).post('/api/auth/login').send({ email: 'owner@test.local', password: 'Password_123!' });
    expect(blocked.status).toBe(403);

    await updateUserStatus(BigInt(registration.body.user.id), 'active');
    ownerLogin = await request(app).post('/api/auth/login').send({ email: 'owner@test.local', password: 'Password_123!' });
    expect(ownerLogin.status).toBe(200);
    expect(ownerLogin.body.user.status.slug).toBe('active');
  });

  it('creates account and owner membership transactionally', async () => {
    const role = await findRoleBySlug('super_admin');
    const superAdmin = await createUser({
      email: 'super@test.local', password: await hashPassword('Password_123!'), name: 'Super Test', statusSlug: 'active',
    });
    await assignGlobalRoleToUser(superAdmin.id, role.id);
    superLogin = await request(app).post('/api/auth/login').send({ email: 'super@test.local', password: 'Password_123!' });

    const created = await request(app).post('/api/admin/accounts')
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ slug: 'cuenta-test', name: 'Cuenta Test', ownerUserId: ownerLogin.body.user.id });
    expect(created.status).toBe(201);
    expect(typeof created.body.account.id).toBe('string');
    expect(created.body.account.subscription.status).toBe('active');

    accountId = created.body.account.id;
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(me.body.accounts[0].role.slug).toBe('owner');
  });

  it('rejects duplicate account slugs and protects the owner membership', async () => {
    const duplicate = await request(app).post('/api/admin/accounts')
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ slug: 'cuenta-test', name: 'Duplicada', ownerUserId: ownerLogin.body.user.id });
    expect(duplicate.status).toBe(409);

    const members = await request(app).get(`/api/accounts/${accountId}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    const ownerMembership = members.body.members.find((member: any) => member.role.slug === 'owner');
    const removed = await request(app).delete(`/api/accounts/${accountId}/members/${ownerMembership.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(removed.status).toBe(409);
  });

  it('prevents duplicate memberships and cross-account reads', async () => {
    const member = await createUser({
      email: 'member@test.local', password: await hashPassword('Password_123!'), name: 'Member Test', statusSlug: 'active',
    });
    const added = await request(app).post(`/api/accounts/${accountId}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ userId: String(member.id), roleSlug: 'cliente' });
    expect(added.status).toBe(201);
    const duplicate = await request(app).post(`/api/accounts/${accountId}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ userId: String(member.id), roleSlug: 'cliente' });
    expect(duplicate.status).toBe(409);

    const outsider = await createUser({
      email: 'outsider@test.local', password: await hashPassword('Password_123!'), name: 'Outsider Test', statusSlug: 'active',
    });
    const outsiderLogin = await request(app).post('/api/auth/login').send({ email: outsider.email, password: 'Password_123!' });
    const forbidden = await request(app).get(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${outsiderLogin.body.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('revokes refresh tokens when suspending a user', async () => {
    const owner = await findUserByEmail('owner@test.local');
    await request(app).patch(`/api/admin/users/${owner.id}/status`)
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ statusSlug: 'suspended' });
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: ownerLogin.body.refreshToken });
    expect(refreshed.status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: 'Password_123!' });
    expect(login.status).toBe(403);
  });

  it('creates account-scoped events and blocks outsiders from event reads', async () => {
    await updateUserStatus(BigInt(ownerLogin.body.user.id), 'active');
    ownerLogin = await request(app).post('/api/auth/login').send({ email: 'owner@test.local', password: 'Password_123!' });

    const created = await request(app).post(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({
        name: 'Evento Cuenta',
        slug: 'evento-cuenta',
        startDate: '2026-09-01',
        status: 'draft',
        timezone: 'America/Bogota',
        modeSlugs: ['foto'],
      });
    expect(created.status).toBe(201);
    expect(created.body.event.accountId).toBe(accountId);
    expect(typeof created.body.event.id).toBe('string');

    const listed = await request(app).get(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.events).toHaveLength(1);

    const outsider = await request(app).post('/api/auth/register').send({
      email: 'event-outsider@test.local', password: 'Password_123!', name: 'Event Outsider',
    });
    await updateUserStatus(BigInt(outsider.body.user.id), 'active');
    const outsiderLogin = await request(app).post('/api/auth/login').send({ email: 'event-outsider@test.local', password: 'Password_123!' });
    const forbidden = await request(app).get(`/api/events/${created.body.event.id}`)
      .set('Authorization', `Bearer ${outsiderLogin.body.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('creates library assets and assigns event resources instead of direct URLs', async () => {
    const event = await request(app).post(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({
        name: 'Evento Recursos',
        slug: 'evento-recursos',
        startDate: '2026-09-02',
        status: 'draft',
        timezone: 'America/Bogota',
        modeSlugs: ['foto'],
      });
    expect(event.status).toBe(201);

    const invalidMime = await request(app).post(`/api/accounts/${accountId}/library/uploads`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ purpose: 'overlay', fileName: 'overlay.pdf', contentType: 'application/pdf', sizeBytes: 100 });
    expect(invalidMime.status).toBe(400);

    const prepared = await request(app).post(`/api/accounts/${accountId}/library/uploads`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ purpose: 'overlay', fileName: 'overlay.png', contentType: 'image/png', sizeBytes: 100 });
    expect(prepared.status).toBe(200);
    expect(prepared.body.key).toContain(`accounts/${accountId}/library/overlay/`);

    const asset = await request(app).post(`/api/accounts/${accountId}/library/assets`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Overlay Cuenta', type: 'overlay', key: prepared.body.key, fileUrl: prepared.body.fileUrl, mimeType: 'image/png', sizeBytes: 100 });
    expect(asset.status).toBe(201);
    expect(asset.body.asset.ownerType).toBe('account');

    const resource = await request(app).post(`/api/events/${event.body.event.id}/resources`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ libraryAssetId: asset.body.asset.id, purpose: 'overlay', orderIndex: 0 });
    expect(resource.status).toBe(201);
    expect(resource.body.resource.asset.fileUrl).toBe(prepared.body.fileUrl);

    const listed = await request(app).get(`/api/events/${event.body.event.id}/resources`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.resources).toHaveLength(1);
  });
});
