/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.integer('estado_id').notNullable().defaultTo(1).after('estado');
  });

  await knex('users').where({ estado: 'pending' }).update({ estado_id: 1 });
  await knex('users').where({ estado: 'active' }).update({ estado_id: 2 });
  await knex('users').where({ estado: 'inactive' }).update({ estado_id: 3 });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('estado_id');
  });
};
