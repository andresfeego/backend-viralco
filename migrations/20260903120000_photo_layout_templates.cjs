/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('library_asset_templates')) return;
  await knex.schema.createTable('library_asset_templates', (table) => {
    table.bigInteger('library_asset_id').unsigned().primary();
    table.integer('schema_version').unsigned().notNullable().defaultTo(1);
    table.string('kind', 64).notNullable();
    table.json('config').notNullable();
    table.string('content_hash', 64).notNullable();
    table.integer('preview_renderer_version').unsigned().notNullable().defaultTo(1);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('library_asset_id', 'library_asset_templates_asset_fk').references('library_assets.id').onDelete('CASCADE');
    table.unique(['content_hash', 'library_asset_id'], 'library_asset_templates_hash_asset_uq');
    table.index(['kind', 'schema_version'], 'library_asset_templates_kind_version_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('library_asset_templates');
};
