import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { app } from '../src/server.ts';
import { db } from '../src/db/index.ts';
import { accountLibraryTable, accountsTable, accountUsersTable, eventBrandingTable, eventModeConfigsTable, eventModeConfigVersionsTable, eventModeSessionsTable, eventModesTable, eventResourcesTable, eventsTable, libraryAssetsTable, libraryAssetVariantsTable, passwordResetTokensTable, refreshTokensTable, subscriptionModesTable, subscriptionsTable, userRolesTable, usersTable } from '../src/db/schema.ts';
import { assignGlobalRoleToUser, createUser, findRoleBySlug, findUserByEmail } from '../src/services/user.service.ts';
import { hashPassword } from '../src/services/crypto.service.ts';

const run = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

run('auth, accounts, subscriptions and events integration', () => {
  let ownerLogin: any;
  let superLogin: any;
  let accountId: string;

  beforeAll(async () => {
    await db.delete(eventBrandingTable);
    await db.delete(eventModeSessionsTable);
    await db.delete(eventModeConfigsTable);
    await db.delete(eventModeConfigVersionsTable);
    await db.delete(eventResourcesTable);
    await db.delete(eventModesTable);
    await db.delete(eventsTable);
    await db.delete(accountLibraryTable);
    await db.delete(libraryAssetVariantsTable);
    await db.delete(libraryAssetsTable);
    await db.delete(subscriptionModesTable);
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

  it('registers an active free identity with no account or global role', async () => {
    const registration = await request(app).post('/api/auth/register').send({
      email: 'owner@test.local', password: 'Password_123!', name: 'Owner Test', phone: null,
    });
    expect(registration.status).toBe(201);
    expect(registration.body.user.status.slug).toBe('active');
    expect(typeof registration.body.user.id).toBe('string');
    expect(registration.body.user.globalRoles).toEqual([]);
    expect(registration.body.user.accounts).toEqual([]);

    ownerLogin = await request(app).post('/api/auth/login').send({ email: 'owner@test.local', password: 'Password_123!' });
    expect(ownerLogin.status).toBe(200);
    expect(ownerLogin.body.user.accounts).toEqual([]);
  });

  it('creates a self-service account with owner membership and trialing subscription', async () => {
    const created = await request(app).post('/api/accounts')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ slug: 'cuenta_test', name: 'Cuenta Test', phone: '123' });
    expect(created.status).toBe(201);
    expect(typeof created.body.account.id).toBe('string');
    expect(created.body.account.subscription.status).toBe('trialing');
    expect(created.body.account.subscription.statusLabel).toBe('Prueba activa');
    expect(created.body.account.subscription.metadata.simulatedCheckout).toBe(true);

    accountId = created.body.account.id;
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(me.body.accounts[0].role.slug).toBe('owner');
  });

  it('keeps assisted account creation for super admin', async () => {
    const role = await findRoleBySlug('super_admin');
    const superAdmin = await createUser({
      email: 'super@test.local', password: await hashPassword('Password_123!'), name: 'Super Test', statusSlug: 'active',
    });
    await assignGlobalRoleToUser(superAdmin.id, role.id);
    superLogin = await request(app).post('/api/auth/login').send({ email: 'super@test.local', password: 'Password_123!' });

    const created = await request(app).post('/api/admin/accounts')
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ slug: 'cuenta_admin', name: 'Cuenta Admin', ownerUserId: ownerLogin.body.user.id });
    expect(created.status).toBe(201);
    expect(created.body.account.subscription.status).toBe('active');
    expect(created.body.account.subscription.metadata.createdByAdmin).toBe(true);
  });

  it('rejects duplicate account slugs and protects the only active owner', async () => {
    const duplicate = await request(app).post('/api/accounts')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ slug: 'cuenta_test', name: 'Duplicada' });
    expect(duplicate.status).toBe(409);

    const members = await request(app).get(`/api/accounts/${accountId}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    const ownerMembership = members.body.members.find((member: any) => member.role.slug === 'owner');
    const removed = await request(app).delete(`/api/accounts/${accountId}/members/${ownerMembership.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(removed.status).toBe(409);
  });

  it('allows invited users to work without paying and blocks outsiders', async () => {
    const member = await createUser({
      email: 'member@test.local', password: await hashPassword('Password_123!'), name: 'Member Test', statusSlug: 'active',
    });
    const added = await request(app).post(`/api/accounts/${accountId}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ userId: String(member.id), roleSlug: 'cliente' });
    expect(added.status).toBe(201);
    const memberLogin = await request(app).post('/api/auth/login').send({ email: member.email, password: 'Password_123!' });
    expect(memberLogin.body.user.accounts[0].account.id).toBe(accountId);

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

    await request(app).patch(`/api/admin/users/${owner.id}/status`)
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ statusSlug: 'active' });
    ownerLogin = await request(app).post('/api/auth/login').send({ email: owner.email, password: 'Password_123!' });
  });

  it('creates account-scoped events only with a valid subscription and contracted modes', async () => {
    for (const slug of ['evento_uno', 'evento_dos', 'evento_tres']) {
      const created = await request(app).post(`/api/accounts/${accountId}/events`)
        .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
        .send({ name: slug, slug, eventTypeSlug: 'boda', startDate: '2026-09-01', status: 'draft', timezone: 'America/Bogota', modeSlugs: ['espejo'] });
      expect(created.status).toBe(201);
      expect(created.body.event.accountId).toBe(accountId);
    }

    const notContracted = await request(app).post(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Evento Cabina', slug: 'evento_cabina', eventTypeSlug: 'boda', startDate: '2026-09-04', status: 'draft', timezone: 'America/Bogota', modeSlugs: ['cabina'] });
    expect(notContracted.status).toBe(403);

    const listed = await request(app).get(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.events).toHaveLength(3);
  });

  it('blocks event creation when account has no valid subscription', async () => {
    const createdAccount = await request(app).post('/api/accounts')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ slug: 'cuenta_sin_suscripcion', name: 'Cuenta Sin Suscripcion' });
    expect(createdAccount.status).toBe(201);
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.accountId, BigInt(createdAccount.body.account.id)));

    const event = await request(app).post(`/api/accounts/${createdAccount.body.account.id}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Sin Subs', slug: 'sin-subs', eventTypeSlug: 'boda', startDate: '2026-10-01', status: 'draft', timezone: 'America/Bogota', modeSlugs: ['espejo'] });
    expect(event.status).toBe(403);
  });

  it('creates library assets and assigns event resources instead of direct URLs', async () => {
    await db.update(eventsTable).set({ status: 'archived' }).where(eq(eventsTable.accountId, BigInt(accountId)));
    const event = await request(app).post(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Evento Recursos', slug: 'evento_recursos', eventTypeSlug: 'boda', startDate: '2026-09-10', status: 'draft', timezone: 'America/Bogota', modeSlugs: ['espejo'] });
    expect(event.status).toBe(201);

    const invalidMime = await request(app).post(`/api/accounts/${accountId}/library/uploads`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ purpose: 'template', fileName: 'overlay.pdf', contentType: 'application/pdf', sizeBytes: 100 });
    expect(invalidMime.status).toBe(400);

    const prepared = await request(app).post(`/api/accounts/${accountId}/library/uploads`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ purpose: 'template', fileName: 'overlay.png', contentType: 'image/png', sizeBytes: 100 });
    expect(prepared.status).toBe(200);
    expect(prepared.body.key).toContain(`accounts/${accountId}/library/template/`);

    const asset = await request(app).post(`/api/accounts/${accountId}/library/assets`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Plantilla Cuenta', type: 'template', key: prepared.body.key, fileUrl: prepared.body.fileUrl, mimeType: 'image/png', sizeBytes: 100 });
    expect(asset.status).toBe(201);
    expect(asset.body.asset.ownerType).toBe('account');

    const resource = await request(app).post(`/api/events/${event.body.event.id}/resources`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ libraryAssetId: asset.body.asset.id, eventModeId: event.body.event.modes[0].id, purpose: 'template', orderIndex: 0 });
    expect(resource.status).toBe(201);
    expect(resource.body.resource.asset.fileUrl).toBe(prepared.body.fileUrl);

    const favorite = await request(app).patch(`/api/accounts/${accountId}/library/${asset.body.asset.id}/favorite`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ isFavorite: true });
    expect(favorite.status).toBe(200);
    expect(favorite.body.library.isFavorite).toBe(true);

    const favorites = await request(app).get(`/api/accounts/${accountId}/library?favorite=true&type=template&q=Plantilla&page=1&pageSize=10`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(favorites.status).toBe(200);
    expect(favorites.body.library).toHaveLength(1);
    expect(favorites.body.pagination.total).toBe(1);

    const configPath = `/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/config`;
    const draft = await request(app).get(configPath).set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(draft.status).toBe(200);
    expect(draft.body.config.revision).toBe(0);
    draft.body.config.config.resources.templateResourceId = resource.body.resource.id;

    const invalidPurposeConfig = structuredClone(draft.body.config.config);
    invalidPurposeConfig.resources.templateResourceId = null;
    invalidPurposeConfig.resources.frameResourceId = resource.body.resource.id;
    const invalidPurpose = await request(app).post(`${configPath}/validate`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ config: invalidPurposeConfig, publish: true });
    expect(invalidPurpose.status).toBe(200);
    expect(invalidPurpose.body.valid).toBe(false);
    expect(invalidPurpose.body.errors.some((entry: any) => entry.code === 'RESOURCE_PURPOSE_MISMATCH')).toBe(true);

    const invalidLayoutConfig = structuredClone(draft.body.config.config);
    invalidLayoutConfig.layout.order = [2];
    const invalidLayout = await request(app).post(`${configPath}/validate`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ config: invalidLayoutConfig });
    expect(invalidLayout.body.valid).toBe(false);
    expect(invalidLayout.body.errors.some((entry: any) => entry.code === 'SHOT_ORDER_INVALID')).toBe(true);

    const saved = await request(app).put(configPath)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ expectedRevision: 0, schemaVersion: 1, config: draft.body.config.config });
    expect(saved.status).toBe(200);
    expect(saved.body.config.revision).toBe(1);

    const stale = await request(app).put(configPath)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ expectedRevision: 0, schemaVersion: 1, config: draft.body.config.config });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('CONFIG_REVISION_CONFLICT');

    const published = await request(app).post(`${configPath}/publish`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ expectedRevision: 1 });
    expect(published.status).toBe(201);
    expect(published.body.version.version).toBe(1);

    const sessionInput = { clientSessionId: '7db45da7-41d7-4ea7-9dc0-423bfbcb0bb8', deviceInstallationId: 'ios-test-device' };
    const session = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send(sessionInput);
    expect(session.status).toBe(201);
    expect(session.body.session.status).toBe('preparing');
    expect(session.body.manifest).toHaveLength(1);

    const repeated = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send(sessionInput);
    expect(repeated.body.session.id).toBe(session.body.session.id);

    const running = await request(app).patch(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/${session.body.session.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ status: 'running' });
    expect(running.body.session.status).toBe('running');

    const ended = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/${session.body.session.id}/end`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ status: 'ended' });
    expect(ended.body.session.status).toBe('ended');
  });

  it('creates processed account logo assets and exposes logoAsset variants on account DTO', async () => {
    const invalidLogo = await request(app).post(`/api/accounts/${accountId}/library/image-upload`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .field('purpose', 'logo')
      .field('name', 'Logo Invalido')
      .attach('file', Buffer.from('not an image'), { filename: 'logo.png', contentType: 'image/png' });
    expect(invalidLogo.status).toBe(400);

    const rectangularImage = await sharp({
      create: { width: 1200, height: 600, channels: 4, background: { r: 200, g: 80, b: 40, alpha: 1 } },
    }).png().toBuffer();
    const rectangularLogo = await request(app).post(`/api/accounts/${accountId}/library/image-upload`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .field('purpose', 'logo')
      .field('name', 'Logo Rectangular')
      .attach('file', rectangularImage, { filename: 'logo-rectangular.png', contentType: 'image/png' });
    expect(rectangularLogo.status).toBe(400);

    const image = await sharp({
      create: { width: 1200, height: 1200, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 1 } },
    }).png().toBuffer();
    const logo = await request(app).post(`/api/accounts/${accountId}/library/image-upload`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .field('purpose', 'logo')
      .field('name', 'Logo Cuenta')
      .attach('file', image, { filename: 'logo.png', contentType: 'image/png' });
    expect(logo.status).toBe(201);
    expect(logo.body.asset.mimeType).toBe('image/webp');
    expect(logo.body.asset.storageKey).toContain(`accounts/${accountId}/library/logo/${logo.body.asset.id}/full.webp`);
    expect(logo.body.asset.previewUrl).toContain(`accounts/${accountId}/library/logo/${logo.body.asset.id}/thumb.webp`);
    expect(logo.body.asset.variants.thumb.fileUrl).toBe(logo.body.asset.previewUrl);
    expect(logo.body.asset.variants.card.storageKey).toContain('/card.webp');
    expect(logo.body.asset.variants.full.fileUrl).toBe(logo.body.asset.fileUrl);

    const updated = await request(app).patch(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ logoAssetId: logo.body.asset.id });
    expect(updated.status).toBe(200);
    expect(updated.body.account.logoAssetId).toBe(logo.body.asset.id);
    expect(updated.body.account.logoAsset.fileUrl).toBe(logo.body.asset.fileUrl);
    expect(updated.body.account.logoAsset.variants.thumb.fileUrl).toBe(logo.body.asset.previewUrl);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(me.body.accounts[0].account.logoAsset.id).toBe(logo.body.asset.id);
    expect(me.body.accounts[0].account.logoAsset.variants.full.fileUrl).toBe(logo.body.asset.fileUrl);
  });
});
