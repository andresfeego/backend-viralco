/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('post', (table) => {
    table.increments('id').primary();
    table.string('title', 255).notNullable();
    table.text('image_url').notNullable();
    table.string('media_type', 50).notNullable().defaultTo('image');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('post');
};
