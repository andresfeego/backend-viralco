import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { app } from '../src/server.ts';
import { db } from '../src/db/index.ts';
import { accountLibraryTable, accountsTable, accountUsersTable, assetEventResourcesTable, assetsTable, deliveriesTable, eventBrandingTable, eventModeConfigsTable, eventModeConfigVersionsTable, eventModeSessionsTable, eventModesTable, eventResourcesTable, eventsTable, eventTypesTable, libraryAssetsTable, libraryAssetEventTypesTable, libraryAssetTemplatesTable, libraryAssetVariantsTable, mirrorCaptureRunsTable, mirrorCapturesTable, passwordResetTokensTable, refreshTokensTable, subscriptionModesTable, subscriptionsTable, userRolesTable, usersTable } from '../src/db/schema.ts';
import { assignGlobalRoleToUser, createUser, findRoleBySlug, findUserByEmail } from '../src/services/user.service.ts';
import { hashPassword } from '../src/services/crypto.service.ts';
import { billingDb } from '../src/db/billing.ts';

const run = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

run('auth, accounts, subscriptions and events integration', () => {
  let ownerLogin: any;
  let superLogin: any;
  let adminLogin: any;
  let accountId: string;
  let adminAccountId: string;
  let historicalEventId: string;

  beforeAll(async () => {
    if (process.env.DB_NAME !== 'viralco_billing_test') throw new Error('Integration tests require isolated viralco_billing_test');
    await billingDb('billing_catalog').update({ archived_by: null, archived_at: null });
    await billingDb('billing_orders').update({ renewal_period_id: null });
    for (const table of ['billing_notices', 'billing_contracts', 'billing_reviews', 'billing_reports', 'billing_periods', 'billing_orders', 'billing_transitions', 'billing_bank_options', 'billing_settings']) await billingDb(table).delete();
    await billingDb('billing_catalog').whereIn('mode_id', billingDb('modes').whereIn('slug', ['espejo', 'cabina', 'video-360']).select('id')).update({ available: true, price_30_cop: 50000, price_365_cop: 500000 });
    await db.delete(eventBrandingTable);
    await db.delete(deliveriesTable);
    await db.delete(assetEventResourcesTable);
    await db.delete(assetsTable);
    await db.delete(mirrorCapturesTable);
    await db.delete(mirrorCaptureRunsTable);
    await db.delete(eventModeSessionsTable);
    await db.delete(eventModeConfigsTable);
    await db.delete(eventModeConfigVersionsTable);
    await db.delete(eventResourcesTable);
    await db.delete(eventModesTable);
    await db.delete(eventsTable);
    await db.delete(accountLibraryTable);
    await db.delete(libraryAssetVariantsTable);
    await db.delete(libraryAssetTemplatesTable);
    await db.delete(libraryAssetEventTypesTable);
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

  it('creates a self-service account pending payment, without automatic activation', async () => {
    const created = await request(app).post('/api/accounts')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ slug: 'cuenta_test', name: 'Cuenta Test', phone: '123', durationDays: 365, modeSlugs: ['espejo'] });
    expect(created.status).toBe(201);
    expect(typeof created.body.account.id).toBe('string');
    expect(created.body.account.subscription.status).toBe('past_due');
    expect(created.body.account.subscription.metadata.paymentMethod).toBe('bank_transfer');
    expect(created.body.account.subscription.metadata.billingPreference).toEqual({ durationDays: 365, modeSlugs: ['espejo'] });
    const billing = await request(app).get(`/api/billing/accounts/${created.body.account.id}`).set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(billing.status).toBe(200);
    expect(billing.body.preference).toEqual({ durationDays: 365, modeSlugs: ['espejo'] });

    accountId = created.body.account.id;
    const mode = await billingDb('modes').where({ slug: 'espejo' }).first();
    await billingDb('billing_periods').insert({ account_id: accountId, source: 'test_fixture', services: JSON.stringify([{ modeId: String(mode.id), slug: 'espejo', name: 'Espejo' }]), starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 86400000) });
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
    expect(created.body.account.subscription.status).toBe('past_due');
    expect(created.body.account.subscription.metadata.createdByAdmin).toBe(true);
    adminAccountId = created.body.account.id;
    const mode = await billingDb('modes').where({ slug: 'espejo' }).first();
    await billingDb('billing_periods').insert({ account_id: adminAccountId, source: 'test_fixture', services: JSON.stringify([{ modeId: String(mode.id), slug: 'espejo', name: 'Espejo' }]), starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 86400000) });

    await db.update(accountsTable).set({ isSystem: true }).where(eq(accountsTable.id, BigInt(created.body.account.id)));
    const protectedStatus = await request(app).patch(`/api/admin/accounts/${created.body.account.id}/status`)
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ status: 'suspended' });
    expect(protectedStatus.status).toBe(409);
    await db.update(accountsTable).set({ isSystem: false }).where(eq(accountsTable.id, BigInt(created.body.account.id)));
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
    expect(removed.status).toBe(410);
  });

  it('retires account-level invitations and blocks outsiders', async () => {
    const member = await createUser({
      email: 'member@test.local', password: await hashPassword('Password_123!'), name: 'Member Test', statusSlug: 'active',
    });
    const added = await request(app).post(`/api/accounts/${accountId}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ userId: String(member.id), roleSlug: 'cliente' });
    expect(added.status).toBe(410);
    const memberLogin = await request(app).post('/api/auth/login').send({ email: member.email, password: 'Password_123!' });
    expect(memberLogin.body.user.accounts).toEqual([]);

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

  it('applies a photo layout preset without an event resource and publishes after its source is archived', async () => {
    const [eventRow] = await db.select().from(eventsTable).where(eq(eventsTable.accountId, BigInt(accountId))).limit(1);
    const [eventModeRow] = await db.select().from(eventModesTable).where(and(eq(eventModesTable.eventId, eventRow.id), eq(eventModesTable.isActive, true))).limit(1);
    const now = new Date();
    const template = {
      schemaVersion: 1, kind: 'mirror-photo-layout', baseFormat: 'personalizar-5x15',
      output: { width: 2000, height: 2960 }, shotCount: 2, order: [1, 2], duplicateStrip: false,
      slots: [
        { slotId: 'slot-1', photoNumber: 1, x: 10, y: 10, width: 80, height: 35, rotation: 0 },
        { slotId: 'slot-2', photoNumber: 2, x: 10, y: 55, width: 80, height: 35, rotation: 0 },
      ],
    };
    const inserted = await db.insert(libraryAssetsTable).values({
      ownerType: 'viralco', ownerAccountId: null, sourceAssetId: null, name: 'Preset independiente', type: 'template', motionType: null,
      appliesToAllEventTypes: true, storageKey: 'viralco/library/test/preset.json', fileUrl: 'https://assets.test/preset.json', previewUrl: null,
      mimeType: 'application/vnd.kaptura.photo-layout+json', sizeBytes: 100n, tags: null,
      metadata: { mirrorCompatible: true, templateKind: 'mirror-photo-layout', contentHash: 'preset-hash' },
      status: 'active', createdBy: BigInt(superLogin.body.user.id), createdAt: now, updatedAt: now,
    });
    const assetId = BigInt(inserted[0].insertId);
    await db.insert(libraryAssetTemplatesTable).values({
      libraryAssetId: assetId, schemaVersion: 1, kind: 'mirror-photo-layout', config: template,
      contentHash: 'preset-hash', previewRendererVersion: 1, createdAt: now, updatedAt: now,
    });

    const applied = await request(app).post(`/api/events/${eventRow.id}/modes/${eventModeRow.id}/layout-templates/${assetId}/apply`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ expectedRevision: 0, source: 'favorite' });
    expect(applied.status).toBe(200);
    expect(applied.body.config.config.layout).toMatchObject({ shotCount: 2, order: [1, 2], presetOrigin: { libraryAssetId: String(assetId), name: 'Preset independiente', source: 'favorite', contentHash: 'preset-hash' } });
    expect(applied.body.config.config.resources.layoutTemplateResourceId).toBeNull();
    expect(applied.body.appliedTemplate.eventResourceId).toBeNull();
    const templateResources = await db.select().from(eventResourcesTable).where(and(eq(eventResourcesTable.eventId, eventRow.id), eq(eventResourcesTable.purpose, 'template')));
    expect(templateResources).toHaveLength(0);

    await db.update(libraryAssetsTable).set({ status: 'archived', updatedAt: new Date() }).where(eq(libraryAssetsTable.id, assetId));
    const validation = await request(app).post(`/api/events/${eventRow.id}/modes/${eventModeRow.id}/config/validate`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ schemaVersion: 1, config: applied.body.config.config, publish: true });
    expect(validation.status).toBe(200);
    expect(validation.body.valid).toBe(true);
    expect(validation.body.errors).not.toContainEqual(expect.objectContaining({ code: 'FRAME_REQUIRED' }));

    const published = await request(app).post(`/api/events/${eventRow.id}/modes/${eventModeRow.id}/config/publish`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ expectedRevision: applied.body.config.revision });
    expect(published.status).toBe(201);
  });

  it('lets an assigned event administrator delete only that event without history', async () => {
    const administrator = await createUser({
      email: 'event-admin@test.local', password: await hashPassword('Password_123!'), name: 'Event Admin', statusSlug: 'active',
    });
    adminLogin = await request(app).post('/api/auth/login').send({ email: administrator.email, password: 'Password_123!' });

    const created = await request(app).post(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Evento eliminable', eventTypeSlug: 'boda', startDate: '2026-09-08', status: 'draft', timezone: 'America/Bogota', modeSlugs: ['espejo'] });
    expect(created.status).toBe(201);
    const added = await request(app).post(`/api/events/${created.body.event.id}/members`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ email: administrator.email, roleSlug: 'admin' });
    expect(added.status).toBe(201);
    const removed = await request(app).delete(`/api/events/${created.body.event.id}`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ deleted: true, archived: false, eventId: created.body.event.id });
    const missing = await request(app).get(`/api/events/${created.body.event.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(missing.status).toBe(404);
  });

  it('exposes active global assets dynamically and isolates shared account favorites', async () => {
    const now = new Date();
    const globalInsert = await db.insert(libraryAssetsTable).values({
      ownerType: 'viralco', ownerAccountId: null, sourceAssetId: null,
      name: 'Marco Global Fototeca', type: 'frame', storageKey: 'viralco/library/test/marco-global.png',
      fileUrl: 'https://assets.test/marco-global.png', previewUrl: 'https://assets.test/marco-global-thumb.webp',
      mimeType: 'image/png', sizeBytes: 100n, tags: ['espejo'], metadata: { mirrorCompatible: true },
      status: 'active', createdBy: BigInt(superLogin.body.user.id), createdAt: now, updatedAt: now,
    });
    const globalAssetId = String(globalInsert[0].insertId);
    const archivedInsert = await db.insert(libraryAssetsTable).values({
      ownerType: 'viralco', ownerAccountId: null, sourceAssetId: null,
      name: 'Marco Global Archivado', type: 'frame', storageKey: 'viralco/library/test/marco-archivado.png',
      fileUrl: 'https://assets.test/marco-archivado.png', previewUrl: null,
      mimeType: 'image/png', sizeBytes: 100n, tags: null, metadata: null,
      status: 'archived', createdBy: BigInt(superLogin.body.user.id), createdAt: now, updatedAt: now,
    });
    const [weddingType] = await db.select({ id: eventTypesTable.id }).from(eventTypesTable).where(eq(eventTypesTable.slug, 'boda')).limit(1);
    const stickerInsert = await db.insert(libraryAssetsTable).values({
      ownerType: 'viralco', ownerAccountId: null, sourceAssetId: null,
      name: 'Sticker Boda', type: 'sticker', motionType: 'animated', appliesToAllEventTypes: false,
      storageKey: 'viralco/library/test/sticker-boda.gif', fileUrl: 'https://assets.test/sticker-boda.gif', previewUrl: null,
      mimeType: 'image/gif', sizeBytes: 100n, tags: null, metadata: { mirrorCompatible: true },
      status: 'active', createdBy: BigInt(superLogin.body.user.id), createdAt: now, updatedAt: now,
    });
    const stickerAssetId = BigInt(stickerInsert[0].insertId);
    await db.insert(libraryAssetEventTypesTable).values({ libraryAssetId: stickerAssetId, eventTypeId: weddingType.id, createdAt: now });

    const linkedBefore = await request(app).get(`/api/accounts/${accountId}/library`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(linkedBefore.status).toBe(200);
    expect(linkedBefore.body.library.some((item: any) => item.libraryAssetId === globalAssetId)).toBe(false);

    const global = await request(app).get(`/api/accounts/${accountId}/library?scope=global&type=frame&q=Fototeca&page=1&pageSize=10`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(global.status).toBe(200);
    expect(global.body.library).toHaveLength(1);
    expect(global.body.library[0]).toMatchObject({ id: null, libraryAssetId: globalAssetId, isFavorite: false });
    expect(global.body.pagination.total).toBe(1);

    const strictWeddingFrames = await request(app).get(`/api/accounts/${accountId}/library?scope=global&type=frame&eventType=boda&q=Fototeca`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(strictWeddingFrames.status).toBe(200);
    expect(strictWeddingFrames.body.library).toHaveLength(0);

    const weddingStickers = await request(app).get(`/api/accounts/${accountId}/library?scope=global&type=sticker&motion=animated&eventType=boda`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(weddingStickers.status).toBe(200);
    expect(weddingStickers.body.library).toHaveLength(1);
    expect(weddingStickers.body.library[0].asset).toMatchObject({
      type: 'sticker', motionType: 'animated', appliesToAllEventTypes: false,
    });
    expect(weddingStickers.body.library[0].asset.eventTypes).toEqual([
      expect.objectContaining({ slug: 'boda' }),
    ]);
    const corporateStickers = await request(app).get(`/api/accounts/${accountId}/library?scope=global&type=sticker&eventType=corporativo`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(corporateStickers.status).toBe(200);
    expect(corporateStickers.body.library).toHaveLength(0);

    const favorite = await request(app).patch(`/api/accounts/${accountId}/library/${globalAssetId}/favorite`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ isFavorite: true });
    expect(favorite.status).toBe(200);
    expect(favorite.body.library).toMatchObject({ libraryAssetId: globalAssetId, isFavorite: true });
    expect(favorite.body.library.id).toEqual(expect.any(String));

    const favorites = await request(app).get(`/api/accounts/${accountId}/library?scope=global&favorite=true`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(favorites.status).toBe(200);
    expect(favorites.body.library.map((item: any) => item.libraryAssetId)).toContain(globalAssetId);

    const otherAccount = await request(app).get(`/api/accounts/${adminAccountId}/library?scope=global&favorite=true`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(otherAccount.status).toBe(200);
    expect(otherAccount.body.library.map((item: any) => item.libraryAssetId)).not.toContain(globalAssetId);

    const unfavorite = await request(app).patch(`/api/accounts/${accountId}/library/${globalAssetId}/favorite`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ isFavorite: false });
    expect(unfavorite.status).toBe(200);
    expect(unfavorite.body.library.isFavorite).toBe(false);

    const invalidScope = await request(app).get(`/api/accounts/${accountId}/library?scope=unknown`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(invalidScope.status).toBe(400);

    await db.delete(accountLibraryTable).where(eq(accountLibraryTable.libraryAssetId, BigInt(globalAssetId)));
    await db.delete(libraryAssetEventTypesTable).where(eq(libraryAssetEventTypesTable.libraryAssetId, stickerAssetId));
    await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, stickerAssetId));
    await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, BigInt(globalAssetId)));
    await db.delete(libraryAssetsTable).where(eq(libraryAssetsTable.id, BigInt(archivedInsert[0].insertId)));
  });

  it('creates library assets and assigns event resources instead of direct URLs', async () => {
    await db.update(eventsTable).set({ status: 'archived' }).where(eq(eventsTable.accountId, BigInt(accountId)));
    const event = await request(app).post(`/api/accounts/${accountId}/events`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Evento Recursos', slug: 'evento_recursos', eventTypeSlug: 'boda', startDate: '2026-09-10', status: 'draft', timezone: 'America/Bogota', modeSlugs: ['espejo'] });
    expect(event.status).toBe(201);
    historicalEventId = event.body.event.id;

    const invalidMime = await request(app).post(`/api/accounts/${accountId}/library/uploads`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ purpose: 'template', fileName: 'overlay.png', contentType: 'image/png', sizeBytes: 100 });
    expect(invalidMime.status).toBe(400);

    const prepared = await request(app).post(`/api/accounts/${accountId}/library/uploads`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ purpose: 'frame', fileName: 'marco.png', contentType: 'image/png', sizeBytes: 100 });
    expect(prepared.status).toBe(200);
    expect(prepared.body.key).toContain(`accounts/${accountId}/library/frame/`);

    const asset = await request(app).post(`/api/accounts/${accountId}/library/assets`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: 'Marco Cuenta', type: 'frame', key: prepared.body.key, fileUrl: prepared.body.fileUrl, mimeType: 'image/png', sizeBytes: 100 });
    expect(asset.status).toBe(201);
    expect(asset.body.asset.ownerType).toBe('account');

    const resource = await request(app).post(`/api/events/${event.body.event.id}/resources`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ libraryAssetId: asset.body.asset.id, eventModeId: event.body.event.modes[0].id, purpose: 'frame', orderIndex: 0 });
    expect(resource.status).toBe(201);
    expect(resource.body.resource.asset.fileUrl).toBe(prepared.body.fileUrl);

    const favorite = await request(app).patch(`/api/accounts/${accountId}/library/${asset.body.asset.id}/favorite`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ isFavorite: true });
    expect(favorite.status).toBe(200);
    expect(favorite.body.library.isFavorite).toBe(true);

    const favorites = await request(app).get(`/api/accounts/${accountId}/library?favorite=true&type=frame&q=Marco&page=1&pageSize=10`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(favorites.status).toBe(200);
    expect(favorites.body.library).toHaveLength(1);
    expect(favorites.body.pagination.total).toBe(1);

    const configPath = `/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/config`;
    const draft = await request(app).get(configPath).set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(draft.status).toBe(200);
    expect(draft.body.config.revision).toBe(0);
    draft.body.config.config.resources.frameResourceId = resource.body.resource.id;

    const invalidPurposeConfig = structuredClone(draft.body.config.config);
    invalidPurposeConfig.resources.frameResourceId = null;
    invalidPurposeConfig.resources.templateResourceId = resource.body.resource.id;
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

    const missingStageAnimationConfig = structuredClone(draft.body.config.config);
    missingStageAnimationConfig.experience.animationEnabledByStage.start = true;
    const missingStageAnimation = await request(app).post(`${configPath}/validate`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ config: missingStageAnimationConfig });
    expect(missingStageAnimation.status).toBe(200);
    expect(missingStageAnimation.body.errors).toContainEqual(expect.objectContaining({
      path: 'experience.animationEnabledByStage.start',
      code: 'ANIMATION_STAGE_RESOURCE_REQUIRED',
    }));

    const disabledAnimations = await request(app).post(`${configPath}/validate`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ config: draft.body.config.config });
    expect(disabledAnimations.body.errors.some((entry: any) => entry.code === 'ANIMATION_STAGE_RESOURCE_REQUIRED')).toBe(false);

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

    await db.update(eventsTable).set({ status: 'active' }).where(eq(eventsTable.id, BigInt(event.body.event.id)));

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

    const active = await request(app).get(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/active`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(active.status).toBe(200);
    expect(active.body.session.id).toBe(session.body.session.id);

    const competing = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ clientSessionId: '17b8bd0d-a724-44c9-8e60-f7825b187327', deviceInstallationId: 'other-device' });
    expect(competing.status).toBe(409);
    expect(competing.body.error).toBe('MIRROR_SESSION_ALREADY_ACTIVE');

    const running = await request(app).patch(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/${session.body.session.id}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ status: 'running' });
    expect(running.body.session.status).toBe('running');

    const run = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/${session.body.session.id}/runs`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ clientRunId: 'efcfdf1e-5d0e-49a3-a8e6-e3b1704d65e5' });
    expect(run.status).toBe(201);
    expect(run.body.run.status).toBe('capturing');

    const runtimeAsset = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/${session.body.session.id}/runs/${run.body.run.id}/assets`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ clientAssetId: '65c4d54d-f17d-4b6b-b682-9980cd57f2be' });
    expect(runtimeAsset.status).toBe(201);
    expect(runtimeAsset.body.asset.status).toBe('processing');

    const repeatedAsset = await request(app).post(`/api/events/${event.body.event.id}/modes/${event.body.event.modes[0].id}/sessions/${session.body.session.id}/runs/${run.body.run.id}/assets`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ clientAssetId: '65c4d54d-f17d-4b6b-b682-9980cd57f2be' });
    expect(repeatedAsset.body.asset.id).toBe(runtimeAsset.body.asset.id);

    const pendingDelivery = await request(app).get(`/api/public/assets/${runtimeAsset.body.asset.publicHash}?method=qr`);
    expect(pendingDelivery.status).toBe(409);
    const [delivery] = await db.select().from(deliveriesTable).where(eq(deliveriesTable.assetId, BigInt(runtimeAsset.body.asset.id)));
    expect(delivery).toMatchObject({ method: 'qr', status: 'pending' });

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

  it('archives events with published or captured history instead of deleting them', async () => {
    const removed = await request(app).delete(`/api/events/${historicalEventId}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ deleted: false, archived: true });
    expect(removed.body.event.status).toBe('archived');
    const preserved = await request(app).get(`/api/events/${historicalEventId}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(preserved.status).toBe(200);
  });

  it('blocks unpaid account mutations and protects system accounts', async () => {
    const created = await request(app).post('/api/accounts')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ slug: 'cuenta_eliminable', name: 'Cuenta Eliminable' });
    expect(created.status).toBe(201);
    const removableAccountId = created.body.account.id;

    const mismatch = await request(app).delete(`/api/accounts/${removableAccountId}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ confirmationName: 'nombre incorrecto' });
    expect(mismatch.status).toBe(403);

    const forbidden = await request(app).delete(`/api/accounts/${removableAccountId}`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ confirmationName: 'Cuenta Eliminable' });
    expect(forbidden.status).toBe(403);

    const removed = await request(app).delete(`/api/accounts/${removableAccountId}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ confirmationName: 'Cuenta Eliminable' });
    expect(removed.status).toBe(403);

    await db.update(accountsTable).set({ isSystem: true }).where(eq(accountsTable.id, BigInt(adminAccountId)));
    const protectedAccount = await request(app).delete(`/api/accounts/${adminAccountId}`)
      .set('Authorization', `Bearer ${superLogin.body.accessToken}`)
      .send({ confirmationName: 'Cuenta Admin' });
    expect(protectedAccount.status).toBe(409);
    await db.update(accountsTable).set({ isSystem: false }).where(eq(accountsTable.id, BigInt(adminAccountId)));
  });

  it('cancels accounts with historical activity and hides them from the owner list', async () => {
    const removed = await request(app).delete(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ confirmationName: 'Cuenta Test' });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ deleted: false, archived: true, accountId, status: 'canceled' });
    const listed = await request(app).get('/api/accounts')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`);
    expect(listed.body.accounts.map((account: any) => account.id)).not.toContain(accountId);
  });
});
