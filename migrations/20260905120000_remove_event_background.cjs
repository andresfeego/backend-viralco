/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('event_branding', 'background_resource_id'))) return;
  await knex.schema.alterTable('event_branding', (table) => {
    table.dropForeign(['background_resource_id']);
  });
  await knex.schema.alterTable('event_branding', (table) => {
    table.dropColumn('background_resource_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('event_branding', 'background_resource_id')) return;
  await knex.schema.alterTable('event_branding', (table) => {
    table.bigInteger('background_resource_id').unsigned().nullable();
    table.foreign('background_resource_id').references('event_resources.id').onDelete('SET NULL');
  });
};
