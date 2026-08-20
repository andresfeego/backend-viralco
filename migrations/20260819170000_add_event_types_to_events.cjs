const DEFAULT_EVENT_TYPES = [
  { slug: 'boda', name: 'Boda', sort_order: 10 },
  { slug: 'cumpleanos', name: 'Cumpleanos', sort_order: 20 },
  { slug: 'bautizo', name: 'Bautizo', sort_order: 30 },
  { slug: 'quince-anos', name: '15 anos', sort_order: 40 },
  { slug: 'grado', name: 'Grado', sort_order: 50 },
  { slug: 'baby-shower', name: 'Baby shower', sort_order: 60 },
  { slug: 'corporativo', name: 'Corporativo', sort_order: 70 },
];

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasEventTypes = await knex.schema.hasTable('event_types');
  if (!hasEventTypes) {
    await knex.schema.createTable('event_types', (table) => {
      table.bigIncrements('id').unsigned().primary();
      table.string('slug', 80).notNullable().unique();
      table.string('name', 120).notNullable();
      table.text('description').nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  for (const row of DEFAULT_EVENT_TYPES) {
    await knex('event_types')
      .insert({ ...row, description: null, is_active: true })
      .onConflict('slug')
      .merge({ name: row.name, sort_order: row.sort_order, is_active: true, updated_at: knex.fn.now() });
  }

  const hasEventTypeId = await knex.schema.hasColumn('events', 'event_type_id');
  if (!hasEventTypeId) {
    await knex.schema.alterTable('events', (table) => {
      table.bigInteger('event_type_id').unsigned().nullable().after('account_id');
    });
  }

  const [defaultType] = await knex('event_types').where({ slug: 'corporativo' }).select('id').limit(1);
  if (defaultType?.id) await knex('events').whereNull('event_type_id').update({ event_type_id: defaultType.id });

  const nullableRows = await knex('events').whereNull('event_type_id').count({ count: '*' });
  if (Number(nullableRows?.[0]?.count || 0) === 0) {
    await knex.schema.alterTable('events', (table) => {
      table.bigInteger('event_type_id').unsigned().notNullable().alter();
    });
  }

  const foreignKeys = await knex.raw(
    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'event_type_id' AND REFERENCED_TABLE_NAME = 'event_types'"
  );
  const rows = Array.isArray(foreignKeys?.[0]) ? foreignKeys[0] : [];
  if (rows.length === 0) {
    await knex.schema.alterTable('events', (table) => {
      table.foreign('event_type_id', 'events_event_type_fk').references('event_types.id').onDelete('RESTRICT');
      table.index(['event_type_id'], 'events_event_type_idx');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasEventTypeId = await knex.schema.hasColumn('events', 'event_type_id');
  if (hasEventTypeId) {
    await knex.schema.alterTable('events', (table) => {
      table.dropForeign(['event_type_id'], 'events_event_type_fk');
      table.dropIndex(['event_type_id'], 'events_event_type_idx');
      table.dropColumn('event_type_id');
    });
  }
  await knex.schema.dropTableIfExists('event_types');
};
