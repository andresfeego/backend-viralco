/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasPriceAmount = await knex.schema.hasColumn('modes', 'price_amount');
  if (!hasPriceAmount) {
    await knex.schema.alterTable('modes', (table) => {
      table.integer('price_amount').notNullable().defaultTo(0).after('description');
      table.string('price_currency', 3).notNullable().defaultTo('USD').after('price_amount');
    });
  }

  const hasSubscriptionModes = await knex.schema.hasTable('subscription_modes');
  if (!hasSubscriptionModes) {
    await knex.schema.createTable('subscription_modes', (table) => {
      table.bigIncrements('id').unsigned().primary();
      table.bigInteger('subscription_id').unsigned().notNullable();
      table.bigInteger('mode_id').unsigned().notNullable();
      table.integer('price_amount').notNullable();
      table.string('price_currency', 3).notNullable().defaultTo('USD');
      table.string('status', 32).notNullable().defaultTo('active');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['subscription_id', 'mode_id'], { indexName: 'subscription_modes_subscription_mode_uq' });
      table.foreign('subscription_id').references('subscriptions.id').onDelete('CASCADE');
      table.foreign('mode_id').references('modes.id').onDelete('RESTRICT');
      table.index(['subscription_id'], 'subscription_modes_subscription_idx');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('subscription_modes');
  const hasPriceAmount = await knex.schema.hasColumn('modes', 'price_amount');
  if (hasPriceAmount) {
    await knex.schema.alterTable('modes', (table) => {
      table.dropColumn('price_currency');
      table.dropColumn('price_amount');
    });
  }
};
