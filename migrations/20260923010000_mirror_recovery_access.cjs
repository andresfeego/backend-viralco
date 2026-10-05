exports.up = async function up(knex) {
  await knex.schema.createTable('event_mode_recovery_access', (table) => {
    table.bigInteger('event_mode_id').unsigned().primary().references('id').inTable('event_modes').onDelete('CASCADE');
    table.string('verifier', 100).notNullable();
    table.bigInteger('updated_by').unsigned().notNullable();
    table.dateTime('updated_at').notNullable();
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('event_mode_recovery_access');
};
