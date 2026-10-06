exports.up = async function (knex) {
  await knex.schema.alterTable('billing_reviews', table => {
    table.text('observations').nullable();
  });
};

exports.down = async function () {
  throw new Error('Payment review observations are audit history; automatic deletion is disabled.');
};
