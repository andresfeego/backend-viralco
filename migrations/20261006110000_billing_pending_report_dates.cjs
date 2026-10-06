// Adopt unresolved historical reports without restarting their review deadline
// or changing any already approved period.
exports.up = async function (knex) {
  await knex.transaction(async tx => {
    const pending = await tx('billing_reports as r').join('billing_orders as o', 'o.id', 'r.order_id')
      .where({ 'r.status': 'pending_review', 'o.status': 'pending_review' }).whereNull('r.period_starts_at')
      .select('r.id', 'r.order_id', 'r.created_at', 'r.amount_cop', 'o.account_id', 'o.duration_days', 'o.amount_cop as expected_amount', 'o.provisional_until');
    for (const report of pending) {
      const last = await tx('billing_periods').where({ account_id: report.account_id }).orderBy('ends_at', 'desc').first();
      const submittedAt = new Date(report.created_at).getTime();
      const startsAt = Math.max(submittedAt, last ? new Date(last.ends_at).getTime() : submittedAt);
      await tx('billing_reports').where({ id: report.id }).update({ period_starts_at: new Date(startsAt), period_ends_at: new Date(startsAt + report.duration_days * 86400000) });
      if (!report.provisional_until && Number(report.amount_cop) === Number(report.expected_amount)) {
        const first = await tx('billing_reports').where({ order_id: report.order_id }).orderBy('id').first();
        await tx('billing_orders').where({ id: report.order_id }).update({ provisional_until: new Date(new Date(first.created_at).getTime() + 3 * 86400000) });
      }
    }
  });
};

exports.down = async function () {
  throw new Error('Do not reset historical payment dates. Use a forward migration.');
};
