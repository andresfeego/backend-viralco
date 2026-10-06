exports.up = async function (knex) {
  await knex.schema.createTable('billing_contracts', t => {
    t.bigInteger('account_id').unsigned().primary().references('id').inTable('accounts').onDelete('RESTRICT');
    t.integer('duration_days').notNullable();
    t.bigInteger('amount_cop').unsigned().notNullable();
    t.json('services').notNullable();
    t.string('source', 32).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('billing_orders', t => {
    t.bigInteger('renewal_period_id').unsigned().unique().references('id').inTable('billing_periods').onDelete('RESTRICT');
    t.dateTime('provisional_until', { precision: 3 });
  });
  await knex.schema.alterTable('billing_reports', t => {
    t.dateTime('period_starts_at', { precision: 3 });
    t.dateTime('period_ends_at', { precision: 3 });
  });
  await knex.schema.createTable('billing_daily_runs', t => {
    t.string('scheduled_for', 10).primary();
    t.dateTime('completed_at', { precision: 3 });
  });
  await knex.schema.createTable('billing_notices', t => {
    t.bigIncrements('id');
    t.bigInteger('account_id').unsigned().notNullable().references('id').inTable('accounts').onDelete('RESTRICT');
    t.bigInteger('order_id').unsigned().notNullable().unique().references('id').inTable('billing_orders').onDelete('RESTRICT');
    t.string('kind', 32).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  // Preserve agreed historical prices first. Legacy preferences without an order
  // can only be adopted when the selected COP catalogue is actually available.
  const json = value => typeof value === 'string' ? JSON.parse(value) : value;
  await knex.transaction(async tx => {
    const accounts = await tx('accounts').where({ is_system: false });
    for (const account of accounts) {
      const latest = await tx('billing_orders').where({ account_id: account.id }).whereNot('status', 'canceled').orderBy('id', 'desc').first();
      const sub = await tx('subscriptions').where({ account_id: account.id }).orderBy('starts_at', 'desc').orderBy('id', 'desc').first();
      const preference = json(sub?.metadata)?.billingPreference;
      let quote = latest ? json(latest.snapshot) : null;
      if (!quote && preference?.modeSlugs?.length && [30, 365].includes(preference.durationDays)) {
        const rows = await tx('billing_catalog as c').join('modes as m', 'm.id', 'c.mode_id').whereIn('m.slug', preference.modeSlugs).select('c.*', 'm.slug');
        const items = rows.map(row => ({ modeId: String(row.mode_id), slug: row.slug, name: row.name, amountCop: Number(row[`price_${preference.durationDays}_cop`]) }));
        if (rows.length === new Set(preference.modeSlugs).size && rows.every(row => row.available && !row.archived_at) && items.every(item => Number.isSafeInteger(item.amountCop) && item.amountCop > 0)) {
          quote = { durationDays: preference.durationDays, amountCop: items.reduce((sum, item) => sum + item.amountCop, 0), items };
        }
      }
      if (!quote || !Number.isSafeInteger(Number(quote.amountCop)) || Number(quote.amountCop) <= 0) continue;
      await tx('billing_contracts').insert({ account_id: account.id, duration_days: quote.durationDays, amount_cop: quote.amountCop, services: JSON.stringify(quote.items), source: latest ? 'historical_order' : 'legacy_preference' });
      const period = await tx('billing_periods').where({ account_id: account.id }).first();
      if (!latest && !period && account.status === 'active' && !['suspended', 'canceled'].includes(sub?.status)) {
        await tx('billing_orders').insert({ account_id: account.id, open_account_id: account.id, status: 'awaiting_payment', duration_days: quote.durationDays, amount_cop: quote.amountCop, snapshot: JSON.stringify({ ...quote, currency: 'COP', kind: 'initial' }), created_by: account.owner_user_id });
      }
    }
  });
};

exports.down = async function () {
  throw new Error('Billing history is append-only. Use a forward migration.');
};
