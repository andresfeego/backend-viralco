/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 255).notNullable().unique();
    table.string('password', 255).notNullable();
    table.enu('estado', ['pending', 'active', 'inactive']).notNullable().defaultTo('pending');
    table.integer('estado_id').notNullable().defaultTo(1);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('roles', (table) => {
    table.increments('id').primary();
    table.string('slug', 64).notNullable().unique();
    table.string('name', 120).notNullable();
  });

  await knex.schema.createTable('permissions', (table) => {
    table.increments('id').primary();
    table.string('slug', 120).notNullable().unique();
    table.string('name', 180).notNullable();
  });

  await knex.schema.createTable('user_roles', (table) => {
    table.integer('user_id').unsigned().notNullable();
    table.integer('role_id').unsigned().notNullable();
    table.primary(['user_id', 'role_id']);
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('role_id').references('roles.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('role_permissions', (table) => {
    table.integer('role_id').unsigned().notNullable();
    table.integer('permission_id').unsigned().notNullable();
    table.primary(['role_id', 'permission_id']);
    table.foreign('role_id').references('roles.id').onDelete('CASCADE');
    table.foreign('permission_id').references('permissions.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('refresh_tokens', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.string('token', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.boolean('revoked').notNullable().defaultTo(false);
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.index(['user_id']);
    table.index(['expires_at']);
  });

  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.string('token', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.boolean('used').notNullable().defaultTo(false);
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.index(['user_id']);
    table.index(['expires_at']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('password_reset_tokens');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('users');
};
