exports.up = async function (knex) {
  await knex.schema.createTable('billing_catalog', t => {
    t.bigInteger('mode_id').unsigned().primary().references('id').inTable('modes').onDelete('RESTRICT');
    t.string('name', 160).notNullable(); t.text('description'); t.json('features');
    t.integer('display_order').notNullable().defaultTo(0);
    t.bigInteger('price_30_cop').unsigned(); t.bigInteger('price_365_cop').unsigned();
    t.boolean('available').notNullable().defaultTo(false);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('billing_settings', t => {
    t.integer('id').primary(); t.json('bank_details').notNullable();
    t.bigInteger('updated_by').unsigned().references('id').inTable('users');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('billing_orders', t => {
    t.bigIncrements('id');
    t.bigInteger('account_id').unsigned().notNullable().references('id').inTable('accounts').onDelete('RESTRICT');
    // NULL allows historical orders; this unique key enforces one open order.
    t.bigInteger('open_account_id').unsigned().unique();
    t.string('status', 32).notNullable(); t.integer('duration_days').notNullable();
    t.bigInteger('amount_cop').unsigned().notNullable(); t.json('snapshot').notNullable();
    t.bigInteger('created_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['account_id', 'status']);
  });
  await knex.schema.createTable('billing_reports', t => {
    t.bigIncrements('id'); t.bigInteger('order_id').unsigned().notNullable().references('id').inTable('billing_orders').onDelete('RESTRICT');
    t.bigInteger('amount_cop').unsigned().notNullable(); t.date('transfer_date').notNullable();
    t.string('reference', 160).notNullable(); t.string('reference_normalized', 160).notNullable().index();
    t.string('receipt_key', 255).notNullable(); t.string('receipt_sha256', 64).notNullable().index();
    t.string('content_type', 64).notNullable(); t.integer('size_bytes').notNullable();
    t.string('status', 32).notNullable().defaultTo('pending_review');
    t.bigInteger('created_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('billing_reviews', t => {
    t.bigIncrements('id'); t.bigInteger('report_id').unsigned().notNullable().unique().references('id').inTable('billing_reports').onDelete('RESTRICT');
    t.string('decision', 32).notNullable(); t.text('reason'); t.string('bank_reference', 160);
    t.bigInteger('received_amount_cop').unsigned();
    t.bigInteger('reviewed_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('billing_periods', t => {
    t.bigIncrements('id'); t.bigInteger('account_id').unsigned().notNullable().references('id').inTable('accounts').onDelete('RESTRICT');
    t.bigInteger('order_id').unsigned().unique().references('id').inTable('billing_orders').onDelete('RESTRICT');
    t.string('source', 32).notNullable(); t.json('services').notNullable();
    t.dateTime('starts_at', { precision: 3 }).notNullable(); t.dateTime('ends_at', { precision: 3 }).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['account_id', 'starts_at', 'ends_at']);
  });
  await knex.schema.createTable('billing_transitions', t => {
    t.bigInteger('account_id').unsigned().primary().references('id').inTable('accounts').onDelete('RESTRICT');
    t.string('transition', 64).notNullable(); t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  // Never infer COP tariffs from legacy USD prices.
  const modes = await knex('modes').select('id', 'name', 'description');
  if (modes.length) await knex('billing_catalog').insert(modes.map((m, i) => ({ mode_id: m.id, name: m.name, description: m.description, display_order: i })));
  // Courtesy is an auditable entitlement, not an invented transfer.
  await knex.transaction(async tx => {
    const now = new Date(); const end = new Date(now.getTime() + 30 * 86400000);
    const accounts = await tx('accounts').where({ status: 'active', is_system: false });
    for (const account of accounts) {
      const sub = await tx('subscriptions').where({ account_id: account.id }).orderBy('starts_at', 'desc').orderBy('id', 'desc').first();
      if (!sub || !['active', 'trialing'].includes(sub.status)) continue;
      const services = await tx('subscription_modes as sm').join('modes as m', 'm.id', 'sm.mode_id').where({ 'sm.subscription_id': sub.id, 'sm.status': 'active' }).select('m.id as modeId', 'm.slug', 'm.name');
      await tx('billing_transitions').insert({ account_id: account.id, transition: 'courtesy_30_days_v1' });
      await tx('billing_periods').insert({ account_id: account.id, source: 'courtesy', services: JSON.stringify(services), starts_at: now, ends_at: end });
      await tx('subscriptions').where({ id: sub.id }).update({ ends_at: end });
    }
  });
};

exports.down = async function () {
  throw new Error('Billing history is append-only. Use a forward migration; automatic rollback is disabled.');
};
