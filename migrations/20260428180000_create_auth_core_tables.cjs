/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('user_statuses', (table) => {
    table.bigIncrements('id').primary();
    table.string('slug', 32).notNullable().unique();
    table.string('name', 80).notNullable();
    table.text('description').nullable();
  });

  await knex.schema.createTable('users', (table) => {
    table.bigIncrements('id').primary();
    table.string('email', 255).notNullable().unique();
    table.string('password', 255).notNullable();
    table.string('name', 180).notNullable();
    table.string('phone', 64).nullable();
    table.bigInteger('status_id').unsigned().notNullable();
    table.enu('theme_mode', ['dark', 'light']).notNullable().defaultTo('dark');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('status_id').references('user_statuses.id').onDelete('RESTRICT');
    table.index(['status_id']);
  });

  await knex.schema.createTable('roles', (table) => {
    table.bigIncrements('id').primary();
    table.string('slug', 64).notNullable().unique();
    table.string('name', 120).notNullable();
    table.text('description').nullable();
  });

  await knex.schema.createTable('permissions', (table) => {
    table.bigIncrements('id').primary();
    table.string('slug', 120).notNullable().unique();
    table.string('name', 180).notNullable();
    table.text('description').nullable();
  });

  await knex.schema.createTable('user_roles', (table) => {
    table.bigInteger('user_id').unsigned().notNullable();
    table.bigInteger('role_id').unsigned().notNullable();
    table.primary(['user_id', 'role_id']);
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('role_id').references('roles.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('role_permissions', (table) => {
    table.bigInteger('role_id').unsigned().notNullable();
    table.bigInteger('permission_id').unsigned().notNullable();
    table.primary(['role_id', 'permission_id']);
    table.foreign('role_id').references('roles.id').onDelete('CASCADE');
    table.foreign('permission_id').references('permissions.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('accounts', (table) => {
    table.bigIncrements('id').primary();
    table.string('slug', 120).notNullable().unique();
    table.string('name', 180).notNullable();
    table.bigInteger('logo_asset_id').unsigned().nullable();
    table.string('phone', 64).nullable();
    table.bigInteger('owner_user_id').unsigned().notNullable();
    table.string('status', 32).notNullable().defaultTo('active');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('owner_user_id').references('users.id').onDelete('RESTRICT');
    table.index(['owner_user_id']);
    table.index(['status']);
  });

  await knex.schema.createTable('account_users', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('account_id').unsigned().notNullable();
    table.bigInteger('user_id').unsigned().notNullable();
    table.bigInteger('role_id').unsigned().notNullable();
    table.string('status', 32).notNullable().defaultTo('active');
    table.bigInteger('invited_by').unsigned().nullable();
    table.timestamp('invited_at').nullable();
    table.timestamp('joined_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['account_id', 'user_id']);
    table.foreign('account_id').references('accounts.id').onDelete('CASCADE');
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('role_id').references('roles.id').onDelete('RESTRICT');
    table.foreign('invited_by').references('users.id').onDelete('SET NULL');
    table.index(['user_id']);
    table.index(['role_id']);
    table.index(['status']);
  });

  await knex.schema.createTable('refresh_tokens', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('token', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.boolean('revoked').notNullable().defaultTo(false);
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.index(['user_id']);
    table.index(['expires_at']);
  });

  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').unsigned().notNullable();
    table.string('token', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.boolean('used').notNullable().defaultTo(false);
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.index(['user_id']);
    table.index(['expires_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('password_reset_tokens');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('account_users');
  await knex.schema.dropTableIfExists('accounts');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('user_statuses');
};
