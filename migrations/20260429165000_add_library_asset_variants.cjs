/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('library_asset_variants');
  if (exists) return;
  await knex.schema.createTable('library_asset_variants', (table) => {
    table.bigIncrements('id').unsigned().primary();
    table.bigInteger('asset_id').unsigned().notNullable();
    table.string('variant', 32).notNullable();
    table.string('storage_key', 1024).notNullable().unique();
    table.string('file_url', 2048).notNullable();
    table.string('mime_type', 120).notNullable();
    table.integer('width').nullable();
    table.integer('height').nullable();
    table.bigInteger('size_bytes').unsigned().nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['asset_id', 'variant'], { indexName: 'library_asset_variants_asset_variant_uq' });
    table.foreign('asset_id').references('library_assets.id').onDelete('CASCADE');
    table.index(['asset_id'], 'library_asset_variants_asset_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('library_asset_variants');
};
