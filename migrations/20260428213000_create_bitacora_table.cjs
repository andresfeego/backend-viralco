/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('bitacora', (table) => {
    table.increments('id').primary();
    table.integer('actor_user_id').unsigned().nullable();
    table.string('actor_email', 255).nullable();
    table.text('actor_roles').nullable();
    table.string('canal', 32).notNullable().defaultTo('api');
    table.string('accion', 160).notNullable();
    table.string('entidad_tipo', 80).nullable();
    table.string('entidad_id', 80).nullable();
    table.enu('resultado', ['success', 'fail']).notNullable().defaultTo('success');
    table.string('http_method', 12).notNullable();
    table.string('http_path', 255).notNullable();
    table.integer('http_status').notNullable();
    table.string('request_id', 64).notNullable();
    table.string('ip_hash', 128).nullable();
    table.string('user_agent', 255).nullable();
    table.text('payload_resumen').nullable();
    table.string('mensaje', 255).notNullable();
    table.string('error_code', 80).nullable();
    table.text('error_detalle').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['created_at']);
    table.index(['actor_user_id']);
    table.index(['accion']);
    table.index(['resultado']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('bitacora');
};
