/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasEmail = await knex.schema.hasColumn('accounts', 'email');
  if (!hasEmail) {
    await knex.schema.alterTable('accounts', (table) => {
      table.string('email', 255).nullable().after('phone');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasEmail = await knex.schema.hasColumn('accounts', 'email');
  if (hasEmail) {
    await knex.schema.alterTable('accounts', (table) => {
      table.dropColumn('email');
    });
  }
};
