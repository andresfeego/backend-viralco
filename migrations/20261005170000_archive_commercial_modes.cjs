exports.up = async knex => {
  await knex.schema.alterTable('billing_catalog', t => {
    t.dateTime('archived_at', { precision: 3 }).nullable().index();
    t.bigInteger('archived_by').unsigned().nullable().references('id').inTable('users').onDelete('RESTRICT');
  });
};
exports.down = async () => { throw new Error('Preserve catalog archive history; use a forward migration.'); };
