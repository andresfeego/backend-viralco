/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.enu('theme_mode', ['dark', 'light']).notNullable().defaultTo('dark').after('estado');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('theme_mode');
  });
};
