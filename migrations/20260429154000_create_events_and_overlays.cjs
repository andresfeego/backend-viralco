/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.string('name', 180).notNullable();
    table.string('slug', 180).notNullable().unique();
    table.date('event_date').notNullable();
    table.enu('status', ['draft', 'active', 'archived']).notNullable().defaultTo('draft');
    table.text('description').nullable();
    table.string('phone', 64).nullable();
    table.text('logo_url').nullable();
    table.text('background_url').nullable();
    table.string('primary_color', 32).nullable();
    table.string('secondary_color', 32).nullable();
    table.string('text_color', 32).nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['status']);
    table.index(['event_date']);
  });

  await knex.schema.createTable('event_overlays', (table) => {
    table.increments('id').primary();
    table.integer('event_id').unsigned().notNullable();
    table.string('name', 180).notNullable();
    table.text('file_url').notNullable();
    table.enu('type', ['frame', 'overlay', 'background', 'logo', 'other']).notNullable().defaultTo('overlay');
    table.integer('layer_order').notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('event_id').references('events.id').onDelete('CASCADE');
    table.index(['event_id']);
    table.index(['event_id', 'layer_order']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('event_overlays');
  await knex.schema.dropTableIfExists('events');
};
