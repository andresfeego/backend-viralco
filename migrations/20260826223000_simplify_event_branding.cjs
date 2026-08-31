/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const columns = ['phone', 'primary_color', 'interval', 'max_events', 'max_storage_gb', 'max_devices', 'features'];
  for (const column of columns) {
    if (await knex.schema.hasColumn('event_branding', column)) {
      await knex.schema.alterTable('event_branding', (table) => {
        table.dropColumn(column);
      });
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('event_branding', (table) => {
    table.string('phone', 64).nullable();
    table.string('primary_color', 32).nullable();
    table.string('interval', 32).nullable();
    table.integer('max_events').nullable();
    table.integer('max_storage_gb').nullable();
    table.integer('max_devices').nullable();
    table.json('features').nullable();
  });
};
