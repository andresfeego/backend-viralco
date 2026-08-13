/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('modes', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('slug', 80).notNullable().unique();
    table.string('name', 120).notNullable();
    table.text('description').nullable();
    table.boolean('is_default').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('subscription_plans', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('slug', 80).notNullable().unique();
    table.string('name', 120).notNullable();
    table.text('description').nullable();
    table.json('limits').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('subscriptions', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('account_id').unsigned().notNullable();
    table.bigInteger('plan_id').unsigned().notNullable();
    table.string('status', 32).notNullable();
    table.timestamp('starts_at').notNullable();
    table.timestamp('ends_at').nullable();
    table.timestamp('canceled_at').nullable();
    table.string('provider', 32).nullable();
    table.string('provider_customer_id', 180).nullable();
    table.string('provider_subscription_id', 180).nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('account_id').references('accounts.id').onDelete('CASCADE');
    table.foreign('plan_id').references('subscription_plans.id').onDelete('RESTRICT');
    table.index(['account_id'], 'subscriptions_account_idx');
  });

  await knex.schema.createTable('library_asset_categories', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('slug', 120).notNullable().unique();
    table.string('name', 180).notNullable();
    table.text('description').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('library_assets', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('category_id').unsigned().nullable();
    table.string('owner_type', 32).notNullable();
    table.bigInteger('owner_account_id').unsigned().nullable();
    table.bigInteger('source_asset_id').unsigned().nullable();
    table.string('name', 180).notNullable();
    table.string('type', 32).notNullable();
    table.string('storage_key', 1024).notNullable().unique();
    table.string('file_url', 2048).notNullable();
    table.string('preview_url', 2048).nullable();
    table.string('mime_type', 120).nullable();
    table.bigInteger('size_bytes').unsigned().nullable();
    table.json('tags').nullable();
    table.json('metadata').nullable();
    table.string('status', 32).notNullable().defaultTo('active');
    table.bigInteger('created_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('category_id').references('library_asset_categories.id').onDelete('SET NULL');
    table.foreign('owner_account_id').references('accounts.id').onDelete('CASCADE');
    table.foreign('source_asset_id').references('library_assets.id').onDelete('SET NULL');
    table.foreign('created_by').references('users.id').onDelete('RESTRICT');
    table.index(['owner_type', 'owner_account_id'], 'library_assets_owner_idx');
    table.index(['type'], 'library_assets_type_idx');
  });

  await knex.schema.createTable('library_asset_variants', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('asset_id').unsigned().notNullable();
    table.string('variant', 32).notNullable();
    table.string('storage_key', 1024).notNullable().unique();
    table.string('file_url', 2048).notNullable();
    table.string('mime_type', 120).notNullable();
    table.integer('width').nullable();
    table.integer('height').nullable();
    table.bigInteger('size_bytes').unsigned().nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['asset_id', 'variant'], { indexName: 'library_asset_variants_asset_variant_uq' });
    table.foreign('asset_id').references('library_assets.id').onDelete('CASCADE');
    table.index(['asset_id'], 'library_asset_variants_asset_idx');
  });

  await knex.schema.alterTable('accounts', (table) => {
    table.foreign('logo_asset_id').references('library_assets.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('account_library', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('account_id').unsigned().notNullable();
    table.bigInteger('library_asset_id').unsigned().notNullable();
    table.string('display_name', 180).nullable();
    table.text('notes').nullable();
    table.bigInteger('added_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['account_id', 'library_asset_id'], { indexName: 'account_library_account_asset_uq' });
    table.foreign('account_id').references('accounts.id').onDelete('CASCADE');
    table.foreign('library_asset_id').references('library_assets.id').onDelete('CASCADE');
    table.foreign('added_by').references('users.id').onDelete('RESTRICT');
  });

  await knex.schema.createTable('events', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('slug', 180).notNullable();
    table.bigInteger('account_id').unsigned().notNullable();
    table.string('name', 180).notNullable();
    table.text('description').nullable();
    table.date('start_date').nullable();
    table.date('end_date').nullable();
    table.string('status', 32).notNullable().defaultTo('draft');
    table.string('timezone', 64).notNullable();
    table.bigInteger('created_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['account_id', 'slug'], { indexName: 'events_account_slug_uq' });
    table.foreign('account_id').references('accounts.id').onDelete('CASCADE');
    table.foreign('created_by').references('users.id').onDelete('RESTRICT');
    table.index(['account_id', 'status'], 'events_account_status_idx');
    table.index(['account_id', 'start_date'], 'events_account_start_date_idx');
  });

  await knex.schema.createTable('event_modes', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_id').unsigned().notNullable();
    table.bigInteger('mode_id').unsigned().notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('order_index').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['event_id', 'mode_id'], { indexName: 'event_modes_event_mode_uq' });
    table.foreign('event_id').references('events.id').onDelete('CASCADE');
    table.foreign('mode_id').references('modes.id').onDelete('RESTRICT');
    table.index(['event_id', 'order_index'], 'event_modes_event_order_idx');
  });

  await knex.schema.createTable('event_users', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_id').unsigned().notNullable();
    table.bigInteger('user_id').unsigned().notNullable();
    table.bigInteger('role_id').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['event_id', 'user_id'], { indexName: 'event_users_event_user_uq' });
    table.foreign('event_id').references('events.id').onDelete('CASCADE');
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('role_id').references('roles.id').onDelete('RESTRICT');
  });

  await knex.schema.createTable('event_resources', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_id').unsigned().notNullable();
    table.bigInteger('library_asset_id').unsigned().notNullable();
    table.bigInteger('event_mode_id').unsigned().nullable();
    table.string('purpose', 32).notNullable();
    table.string('placement', 32).nullable();
    table.json('config').nullable();
    table.integer('order_index').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('event_id').references('events.id').onDelete('CASCADE');
    table.foreign('library_asset_id').references('library_assets.id').onDelete('RESTRICT');
    table.foreign('event_mode_id').references('event_modes.id').onDelete('SET NULL');
    table.index(['event_id', 'purpose', 'order_index'], 'event_resources_event_purpose_order_idx');
  });

  await knex.schema.createTable('event_branding', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_id').unsigned().notNullable();
    table.bigInteger('logo_resource_id').unsigned().nullable();
    table.bigInteger('background_resource_id').unsigned().nullable();
    table.string('phone', 64).nullable();
    table.string('primary_color', 32).nullable();
    table.string('interval', 32).nullable();
    table.integer('max_events').nullable();
    table.integer('max_storage_gb').nullable();
    table.integer('max_devices').nullable();
    table.json('features').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['event_id'], { indexName: 'event_branding_event_uq' });
    table.foreign('event_id').references('events.id').onDelete('CASCADE');
    table.foreign('logo_resource_id').references('event_resources.id').onDelete('SET NULL');
    table.foreign('background_resource_id').references('event_resources.id').onDelete('SET NULL');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('event_branding');
  await knex.schema.dropTableIfExists('event_resources');
  await knex.schema.dropTableIfExists('event_users');
  await knex.schema.dropTableIfExists('event_modes');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('account_library');
  await knex.schema.alterTable('accounts', (table) => {
    table.dropForeign(['logo_asset_id']);
  });
  await knex.schema.dropTableIfExists('library_asset_variants');
  await knex.schema.dropTableIfExists('library_assets');
  await knex.schema.dropTableIfExists('library_asset_categories');
  await knex.schema.dropTableIfExists('subscriptions');
  await knex.schema.dropTableIfExists('subscription_plans');
  await knex.schema.dropTableIfExists('modes');
};
