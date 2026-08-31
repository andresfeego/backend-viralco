/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('account_library', (table) => {
    table.boolean('is_favorite').notNullable().defaultTo(false).after('notes');
    table.timestamp('favorited_at').nullable().after('is_favorite');
    table.bigInteger('favorited_by').unsigned().nullable().after('favorited_at');
    table.foreign('favorited_by').references('users.id').onDelete('SET NULL');
    table.index(['account_id', 'is_favorite'], 'account_library_account_favorite_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('account_library', (table) => {
    table.dropIndex(['account_id', 'is_favorite'], 'account_library_account_favorite_idx');
    table.dropForeign(['favorited_by']);
    table.dropColumns('favorited_by', 'favorited_at', 'is_favorite');
  });
};
