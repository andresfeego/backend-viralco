/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('accounts', (table) => {
    table.boolean('is_system').notNullable().defaultTo(false).after('status');
    table.index(['is_system', 'status'], 'accounts_system_status_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('accounts', (table) => {
    table.dropIndex(['is_system', 'status'], 'accounts_system_status_idx');
    table.dropColumn('is_system');
  });
};
