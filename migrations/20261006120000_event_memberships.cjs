exports.up = async function (knex) {
  await knex.schema.alterTable('event_users', table => {
    table.string('status', 20).notNullable().defaultTo('active');
    table.dateTime('updated_at').nullable();
  });
  // Keep an audit copy. Rollback must never silently restore revoked access.
  await knex.schema.createTable('retired_account_memberships', table => {
    table.bigInteger('membership_id').unsigned().primary();
    table.json('snapshot').notNullable();
    table.dateTime('retired_at').notNullable();
  });
  await knex.transaction(async tx => {
    const rows = await tx('account_users as au').join('roles as r', 'r.id', 'au.role_id')
      .join('accounts as a', 'a.id', 'au.account_id').whereNot('r.slug', 'owner')
      .whereRaw('au.user_id <> a.owner_user_id').select('au.*').forUpdate();
    for (const row of rows) {
      await tx('retired_account_memberships').insert({ membership_id: row.id, snapshot: JSON.stringify(row), retired_at: new Date() });
      await tx('account_users').where({ id: row.id }).delete();
    }
  });
};
exports.down = async function () {
  throw new Error('Membership retirement requires an explicit access review; automatic restoration is disabled.');
};
