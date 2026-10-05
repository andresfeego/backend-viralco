exports.up = async knex => {
  await knex.schema.createTable('billing_bank_options', t => {
    t.bigIncrements('id');
    t.json('bank_details').notNullable();
    t.boolean('active').notNullable().defaultTo(true).index();
    t.integer('revision').unsigned().notNullable().defaultTo(1);
    t.integer('legacy_settings_id').nullable().unique();
    t.bigInteger('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  const legacy = await knex('billing_settings').where({ id: 1 }).first();
  if (legacy) await knex('billing_bank_options').insert({
    bank_details: typeof legacy.bank_details === 'string' ? legacy.bank_details : JSON.stringify(legacy.bank_details),
    active: true, legacy_settings_id: 1, updated_by: legacy.updated_by, updated_at: legacy.updated_at,
  });
  // Existing orders keep their immutable snapshot.bank. No order is rewritten.
};
exports.down = async () => { throw new Error('Preserve transfer options and history; use a forward migration.'); };
