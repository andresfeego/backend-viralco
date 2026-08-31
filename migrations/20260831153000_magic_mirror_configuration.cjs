/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('event_mode_configs', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_mode_id').unsigned().notNullable().unique();
    table.integer('schema_version').notNullable().defaultTo(1);
    table.integer('revision').notNullable().defaultTo(1);
    table.json('config').notNullable();
    table.bigInteger('published_version_id').unsigned().nullable();
    table.bigInteger('updated_by').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('event_mode_id').references('event_modes.id').onDelete('CASCADE');
    table.foreign('updated_by').references('users.id').onDelete('RESTRICT');
  });

  await knex.schema.createTable('event_mode_config_versions', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_mode_id').unsigned().notNullable();
    table.integer('version').notNullable();
    table.integer('schema_version').notNullable().defaultTo(1);
    table.json('config').notNullable();
    table.bigInteger('published_by').unsigned().notNullable();
    table.timestamp('published_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['event_mode_id', 'version'], { indexName: 'event_mode_config_versions_mode_version_uq' });
    table.foreign('event_mode_id').references('event_modes.id').onDelete('CASCADE');
    table.foreign('published_by').references('users.id').onDelete('RESTRICT');
  });

  await knex.schema.alterTable('event_mode_configs', (table) => {
    table.foreign('published_version_id').references('event_mode_config_versions.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('event_mode_sessions', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('event_mode_id').unsigned().notNullable();
    table.bigInteger('config_version_id').unsigned().notNullable();
    table.string('client_session_id', 80).notNullable().unique();
    table.string('device_installation_id', 120).notNullable();
    table.bigInteger('started_by').unsigned().notNullable();
    table.string('status', 32).notNullable().defaultTo('preparing');
    table.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('ended_at').nullable();
    table.timestamp('last_heartbeat_at').nullable();
    table.string('failure_code', 80).nullable();
    table.json('metadata').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('event_mode_id').references('event_modes.id').onDelete('CASCADE');
    table.foreign('config_version_id').references('event_mode_config_versions.id').onDelete('RESTRICT');
    table.foreign('started_by').references('users.id').onDelete('RESTRICT');
    table.index(['event_mode_id', 'status'], 'event_mode_sessions_mode_status_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('event_mode_sessions');
  await knex.schema.alterTable('event_mode_configs', (table) => {
    table.dropForeign(['published_version_id']);
  });
  await knex.schema.dropTableIfExists('event_mode_config_versions');
  await knex.schema.dropTableIfExists('event_mode_configs');
};
