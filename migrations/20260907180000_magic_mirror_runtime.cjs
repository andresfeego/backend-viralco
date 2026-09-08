/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('mirror_capture_runs', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_mode_session_id').unsigned().notNullable();
    table.string('client_run_id', 80).notNullable().unique();
    table.string('status', 32).notNullable().defaultTo('capturing');
    table.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at').nullable();
    table.string('failure_code', 80).nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('event_mode_session_id').references('event_mode_sessions.id').onDelete('RESTRICT');
    table.index(['event_mode_session_id', 'status'], 'mirror_capture_runs_session_status_idx');
  });

  await knex.schema.createTable('mirror_captures', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('capture_run_id').unsigned().notNullable();
    table.string('client_capture_id', 80).notNullable().unique();
    table.integer('photo_number').unsigned().notNullable();
    table.integer('attempt').unsigned().notNullable().defaultTo(1);
    table.string('status', 32).notNullable().defaultTo('captured');
    table.string('storage_key', 1024).nullable().unique();
    table.string('mime_type', 120).nullable();
    table.bigInteger('size_bytes').unsigned().nullable();
    table.string('sha256', 64).nullable();
    table.timestamp('captured_at').notNullable();
    table.timestamp('uploaded_at').nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('capture_run_id').references('mirror_capture_runs.id').onDelete('RESTRICT');
    table.unique(['capture_run_id', 'photo_number', 'attempt'], { indexName: 'mirror_captures_run_photo_attempt_uq' });
    table.index(['capture_run_id', 'status'], 'mirror_captures_run_status_idx');
  });

  await knex.schema.createTable('assets', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.string('public_hash', 25).notNullable().unique();
    table.string('client_asset_id', 80).notNullable().unique();
    table.bigInteger('event_id').unsigned().notNullable();
    table.bigInteger('event_mode_id').unsigned().notNullable();
    table.bigInteger('event_mode_session_id').unsigned().notNullable();
    table.bigInteger('capture_run_id').unsigned().notNullable();
    table.string('type', 32).notNullable().defaultTo('photo');
    table.string('status', 32).notNullable().defaultTo('processing');
    table.string('storage_key', 1024).nullable().unique();
    table.string('file_url', 2048).nullable();
    table.string('thumbnail_storage_key', 1024).nullable();
    table.string('mime_type', 120).nullable();
    table.bigInteger('size_bytes').unsigned().nullable();
    table.string('sha256', 64).nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('event_id').references('events.id').onDelete('RESTRICT');
    table.foreign('event_mode_id').references('event_modes.id').onDelete('RESTRICT');
    table.foreign('event_mode_session_id').references('event_mode_sessions.id').onDelete('RESTRICT');
    table.foreign('capture_run_id').references('mirror_capture_runs.id').onDelete('RESTRICT');
    table.index(['event_id', 'status'], 'assets_event_status_idx');
    table.index(['event_mode_session_id', 'status'], 'assets_session_status_idx');
  });

  await knex.schema.createTable('asset_event_resources', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('asset_id').unsigned().notNullable();
    table.bigInteger('event_resource_id').unsigned().notNullable();
    table.integer('order_index').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('asset_id').references('assets.id').onDelete('CASCADE');
    table.foreign('event_resource_id').references('event_resources.id').onDelete('RESTRICT');
    table.unique(['asset_id', 'event_resource_id'], { indexName: 'asset_event_resources_asset_resource_uq' });
  });

  await knex.schema.createTable('deliveries', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('asset_id').unsigned().notNullable();
    table.string('method', 32).notNullable();
    table.string('status', 32).notNullable().defaultTo('requested');
    table.timestamp('delivered_at').nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('asset_id').references('assets.id').onDelete('CASCADE');
    table.index(['asset_id', 'method'], 'deliveries_asset_method_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('deliveries');
  await knex.schema.dropTableIfExists('asset_event_resources');
  await knex.schema.dropTableIfExists('assets');
  await knex.schema.dropTableIfExists('mirror_captures');
  await knex.schema.dropTableIfExists('mirror_capture_runs');
};
