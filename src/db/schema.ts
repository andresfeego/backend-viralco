import { bigint, boolean, date, datetime, index, int, json, mysqlEnum, mysqlTable, primaryKey, text, uniqueIndex, varchar, char } from 'drizzle-orm/mysql-core';

export const postTable = mysqlTable('post', {
  id: int('id', { unsigned: true }).autoincrement().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  imageUrl: text('image_url').notNull(),
  mediaType: varchar('media_type', { length: 50 }).notNull().default('image'),
});

export const userStatusesTable = mysqlTable('user_statuses', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 80 }).notNull(),
  description: text('description'),
});

export const usersTable = mysqlTable('users', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  name: varchar('name', { length: 180 }).notNull(),
  phone: varchar('phone', { length: 64 }),
  statusId: bigint('status_id', { mode: 'bigint', unsigned: true }).notNull(),
  themeMode: mysqlEnum('theme_mode', ['dark', 'light']).notNull().default('dark'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export const rolesTable = mysqlTable('roles', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
});

export const permissionsTable = mysqlTable('permissions', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  name: varchar('name', { length: 180 }).notNull(),
  description: text('description'),
});

export const userRolesTable = mysqlTable(
  'user_roles',
  {
    userId: bigint('user_id', { mode: 'bigint', unsigned: true }).notNull(),
    roleId: bigint('role_id', { mode: 'bigint', unsigned: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })]
);

export const rolePermissionsTable = mysqlTable(
  'role_permissions',
  {
    roleId: bigint('role_id', { mode: 'bigint', unsigned: true }).notNull(),
    permissionId: bigint('permission_id', { mode: 'bigint', unsigned: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]
);

export const accountsTable = mysqlTable(
  'accounts',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 180 }).notNull(),
    logoAssetId: bigint('logo_asset_id', { mode: 'bigint', unsigned: true }),
    phone: varchar('phone', { length: 64 }),
    email: varchar('email', { length: 255 }),
    ownerUserId: bigint('owner_user_id', { mode: 'bigint', unsigned: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('accounts_slug_uq').on(table.slug),
    index('accounts_owner_idx').on(table.ownerUserId),
    index('accounts_system_status_idx').on(table.isSystem, table.status),
  ]
);

export const accountUsersTable = mysqlTable(
  'account_users',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    accountId: bigint('account_id', { mode: 'bigint', unsigned: true }).notNull(),
    userId: bigint('user_id', { mode: 'bigint', unsigned: true }).notNull(),
    roleId: bigint('role_id', { mode: 'bigint', unsigned: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    invitedBy: bigint('invited_by', { mode: 'bigint', unsigned: true }),
    invitedAt: datetime('invited_at'),
    joinedAt: datetime('joined_at'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('account_users_account_user_uq').on(table.accountId, table.userId),
    index('account_users_user_idx').on(table.userId),
  ]
);

export const refreshTokensTable = mysqlTable('refresh_tokens', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'bigint', unsigned: true }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: datetime('expires_at').notNull(),
  revoked: boolean('revoked').notNull().default(false),
});

export const passwordResetTokensTable = mysqlTable('password_reset_tokens', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'bigint', unsigned: true }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: datetime('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
});

export const bitacoraTable = mysqlTable('bitacora', {
  id: int('id', { unsigned: true }).autoincrement().primaryKey(),
  actorUserId: bigint('actor_user_id', { mode: 'bigint', unsigned: true }),
  actorEmail: varchar('actor_email', { length: 255 }),
  actorRoles: text('actor_roles'),
  canal: varchar('canal', { length: 32 }).notNull().default('api'),
  accion: varchar('accion', { length: 160 }).notNull(),
  entidadTipo: varchar('entidad_tipo', { length: 80 }),
  entidadId: varchar('entidad_id', { length: 80 }),
  resultado: mysqlEnum('resultado', ['success', 'fail']).notNull().default('success'),
  httpMethod: varchar('http_method', { length: 12 }).notNull(),
  httpPath: varchar('http_path', { length: 255 }).notNull(),
  httpStatus: int('http_status').notNull(),
  requestId: varchar('request_id', { length: 64 }).notNull(),
  ipHash: varchar('ip_hash', { length: 128 }),
  userAgent: varchar('user_agent', { length: 255 }),
  payloadResumen: text('payload_resumen'),
  mensaje: varchar('mensaje', { length: 255 }).notNull(),
  errorCode: varchar('error_code', { length: 80 }),
  errorDetalle: text('error_detalle'),
  createdAt: datetime('created_at').notNull(),
});

export const eventTypesTable = mysqlTable('event_types', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export const eventsTable = mysqlTable(
  'events',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 180 }).notNull(),
    accountId: bigint('account_id', { mode: 'bigint', unsigned: true }).notNull(),
    eventTypeId: bigint('event_type_id', { mode: 'bigint', unsigned: true }).notNull(),
    name: varchar('name', { length: 180 }).notNull(),
    description: text('description'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    createdBy: bigint('created_by', { mode: 'bigint', unsigned: true }).notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('events_account_slug_uq').on(table.accountId, table.slug),
    index('events_account_status_idx').on(table.accountId, table.status),
    index('events_account_start_date_idx').on(table.accountId, table.startDate),
    index('events_event_type_idx').on(table.eventTypeId),
  ]
);

export const eventBrandingTable = mysqlTable(
  'event_branding',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventId: bigint('event_id', { mode: 'bigint', unsigned: true }).notNull(),
    logoResourceId: bigint('logo_resource_id', { mode: 'bigint', unsigned: true }),
    backgroundResourceId: bigint('background_resource_id', { mode: 'bigint', unsigned: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [uniqueIndex('event_branding_event_uq').on(table.eventId)]
);

export const eventUsersTable = mysqlTable(
  'event_users',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventId: bigint('event_id', { mode: 'bigint', unsigned: true }).notNull(),
    userId: bigint('user_id', { mode: 'bigint', unsigned: true }).notNull(),
    roleId: bigint('role_id', { mode: 'bigint', unsigned: true }).notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [uniqueIndex('event_users_event_user_uq').on(table.eventId, table.userId)]
);

export const modesTable = mysqlTable('modes', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  priceAmount: int('price_amount').notNull().default(0),
  priceCurrency: varchar('price_currency', { length: 3 }).notNull().default('USD'),
  isDefault: boolean('is_default').notNull().default(false),
});

export const eventModesTable = mysqlTable(
  'event_modes',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventId: bigint('event_id', { mode: 'bigint', unsigned: true }).notNull(),
    modeId: bigint('mode_id', { mode: 'bigint', unsigned: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    orderIndex: int('order_index').notNull().default(0),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('event_modes_event_mode_uq').on(table.eventId, table.modeId),
    index('event_modes_event_order_idx').on(table.eventId, table.orderIndex),
  ]
);

export const eventModeConfigsTable = mysqlTable(
  'event_mode_configs',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventModeId: bigint('event_mode_id', { mode: 'bigint', unsigned: true }).notNull(),
    schemaVersion: int('schema_version').notNull().default(1),
    revision: int('revision').notNull().default(1),
    config: json('config').notNull(),
    publishedVersionId: bigint('published_version_id', { mode: 'bigint', unsigned: true }),
    updatedBy: bigint('updated_by', { mode: 'bigint', unsigned: true }).notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [uniqueIndex('event_mode_configs_mode_uq').on(table.eventModeId)]
);

export const eventModeConfigVersionsTable = mysqlTable(
  'event_mode_config_versions',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventModeId: bigint('event_mode_id', { mode: 'bigint', unsigned: true }).notNull(),
    version: int('version').notNull(),
    schemaVersion: int('schema_version').notNull().default(1),
    config: json('config').notNull(),
    publishedBy: bigint('published_by', { mode: 'bigint', unsigned: true }).notNull(),
    publishedAt: datetime('published_at').notNull(),
  },
  (table) => [uniqueIndex('event_mode_config_versions_mode_version_uq').on(table.eventModeId, table.version)]
);

export const eventModeSessionsTable = mysqlTable(
  'event_mode_sessions',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventModeId: bigint('event_mode_id', { mode: 'bigint', unsigned: true }).notNull(),
    configVersionId: bigint('config_version_id', { mode: 'bigint', unsigned: true }).notNull(),
    clientSessionId: varchar('client_session_id', { length: 80 }).notNull().unique(),
    deviceInstallationId: varchar('device_installation_id', { length: 120 }).notNull(),
    startedBy: bigint('started_by', { mode: 'bigint', unsigned: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('preparing'),
    startedAt: datetime('started_at').notNull(),
    endedAt: datetime('ended_at'),
    lastHeartbeatAt: datetime('last_heartbeat_at'),
    failureCode: varchar('failure_code', { length: 80 }),
    metadata: json('metadata'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [index('event_mode_sessions_mode_status_idx').on(table.eventModeId, table.status)]
);

export const subscriptionPlansTable = mysqlTable('subscription_plans', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  limits: json('limits'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export const subscriptionsTable = mysqlTable(
  'subscriptions',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    accountId: bigint('account_id', { mode: 'bigint', unsigned: true }).notNull(),
    planId: bigint('plan_id', { mode: 'bigint', unsigned: true }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    startsAt: datetime('starts_at').notNull(),
    endsAt: datetime('ends_at'),
    canceledAt: datetime('canceled_at'),
    provider: varchar('provider', { length: 32 }),
    providerCustomerId: varchar('provider_customer_id', { length: 180 }),
    providerSubscriptionId: varchar('provider_subscription_id', { length: 180 }),
    metadata: json('metadata'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [index('subscriptions_account_idx').on(table.accountId)]
);

export const subscriptionModesTable = mysqlTable(
  'subscription_modes',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    subscriptionId: bigint('subscription_id', { mode: 'bigint', unsigned: true }).notNull(),
    modeId: bigint('mode_id', { mode: 'bigint', unsigned: true }).notNull(),
    priceAmount: int('price_amount').notNull(),
    priceCurrency: varchar('price_currency', { length: 3 }).notNull().default('USD'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('subscription_modes_subscription_mode_uq').on(table.subscriptionId, table.modeId),
    index('subscription_modes_subscription_idx').on(table.subscriptionId),
  ]
);

export const libraryAssetCategoriesTable = mysqlTable('library_asset_categories', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  name: varchar('name', { length: 180 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export const libraryAssetsTable = mysqlTable(
  'library_assets',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    categoryId: bigint('category_id', { mode: 'bigint', unsigned: true }),
    ownerType: varchar('owner_type', { length: 32 }).notNull(),
    ownerAccountId: bigint('owner_account_id', { mode: 'bigint', unsigned: true }),
    sourceAssetId: bigint('source_asset_id', { mode: 'bigint', unsigned: true }),
    name: varchar('name', { length: 180 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    motionType: varchar('motion_type', { length: 16 }),
    appliesToAllEventTypes: boolean('applies_to_all_event_types').notNull().default(true),
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),
    fileUrl: varchar('file_url', { length: 2048 }).notNull(),
    previewUrl: varchar('preview_url', { length: 2048 }),
    mimeType: varchar('mime_type', { length: 120 }),
    sizeBytes: bigint('size_bytes', { mode: 'bigint', unsigned: true }),
    tags: json('tags'),
    metadata: json('metadata'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdBy: bigint('created_by', { mode: 'bigint', unsigned: true }).notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('library_assets_storage_key_uq').on(table.storageKey),
    index('library_assets_owner_idx').on(table.ownerType, table.ownerAccountId),
    index('library_assets_type_idx').on(table.type),
    index('library_assets_type_motion_idx').on(table.type, table.motionType),
  ]
);

export const libraryAssetEventTypesTable = mysqlTable(
  'library_asset_event_types',
  {
    libraryAssetId: bigint('library_asset_id', { mode: 'bigint', unsigned: true }).notNull().references(() => libraryAssetsTable.id, { onDelete: 'cascade' }),
    eventTypeId: bigint('event_type_id', { mode: 'bigint', unsigned: true }).notNull().references(() => eventTypesTable.id, { onDelete: 'cascade' }),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.libraryAssetId, table.eventTypeId], name: 'library_asset_event_types_pk' }),
    index('library_asset_event_types_event_type_idx').on(table.eventTypeId, table.libraryAssetId),
  ]
);

export const libraryAssetVariantsTable = mysqlTable(
  'library_asset_variants',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    assetId: bigint('asset_id', { mode: 'bigint', unsigned: true }).notNull(),
    variant: varchar('variant', { length: 32 }).notNull(),
    storageKey: varchar('storage_key', { length: 1024 }).notNull(),
    fileUrl: varchar('file_url', { length: 2048 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    width: int('width'),
    height: int('height'),
    sizeBytes: bigint('size_bytes', { mode: 'bigint', unsigned: true }),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('library_asset_variants_asset_variant_uq').on(table.assetId, table.variant),
    uniqueIndex('library_asset_variants_storage_key_uq').on(table.storageKey),
    index('library_asset_variants_asset_idx').on(table.assetId),
  ]
);

export const accountLibraryTable = mysqlTable(
  'account_library',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    accountId: bigint('account_id', { mode: 'bigint', unsigned: true }).notNull(),
    libraryAssetId: bigint('library_asset_id', { mode: 'bigint', unsigned: true }).notNull(),
    displayName: varchar('display_name', { length: 180 }),
    notes: text('notes'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    favoritedAt: datetime('favorited_at'),
    favoritedBy: bigint('favorited_by', { mode: 'bigint', unsigned: true }),
    addedBy: bigint('added_by', { mode: 'bigint', unsigned: true }).notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('account_library_account_asset_uq').on(table.accountId, table.libraryAssetId),
    index('account_library_account_favorite_idx').on(table.accountId, table.isFavorite),
  ]
);

export const eventResourcesTable = mysqlTable(
  'event_resources',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    eventId: bigint('event_id', { mode: 'bigint', unsigned: true }).notNull(),
    libraryAssetId: bigint('library_asset_id', { mode: 'bigint', unsigned: true }).notNull(),
    eventModeId: bigint('event_mode_id', { mode: 'bigint', unsigned: true }),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    placement: varchar('placement', { length: 32 }),
    config: json('config'),
    orderIndex: int('order_index').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [index('event_resources_event_purpose_order_idx').on(table.eventId, table.purpose, table.orderIndex)]
);

export const assetsTable = mysqlTable('assets', {
  id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
  publicHash: char('public_hash', { length: 25 }).notNull().unique(),
  eventId: bigint('event_id', { mode: 'bigint', unsigned: true }).notNull(),
  modeId: bigint('mode_id', { mode: 'bigint', unsigned: true }),
  type: varchar('type', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  fileUrl: varchar('file_url', { length: 2048 }).notNull(),
  thumbnailUrl: varchar('thumbnail_url', { length: 2048 }),
  durationSec: int('duration_sec'),
  sizeBytes: bigint('size_bytes', { mode: 'bigint', unsigned: true }),
  metadata: json('metadata'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export const assetEventResourcesTable = mysqlTable(
  'asset_event_resources',
  {
    id: bigint('id', { mode: 'bigint', unsigned: true }).autoincrement().primaryKey(),
    assetId: bigint('asset_id', { mode: 'bigint', unsigned: true }).notNull(),
    eventResourceId: bigint('event_resource_id', { mode: 'bigint', unsigned: true }).notNull(),
    orderIndex: int('order_index').notNull().default(0),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [uniqueIndex('asset_event_resources_asset_resource_uq').on(table.assetId, table.eventResourceId)]
);
