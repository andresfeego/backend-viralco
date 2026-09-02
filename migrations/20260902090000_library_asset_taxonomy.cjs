/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasMotionType = await knex.schema.hasColumn('library_assets', 'motion_type');
  const hasUniversalFlag = await knex.schema.hasColumn('library_assets', 'applies_to_all_event_types');
  if (!hasMotionType || !hasUniversalFlag) {
    await knex.schema.alterTable('library_assets', (table) => {
      if (!hasMotionType) table.string('motion_type', 16).nullable().after('type');
      if (!hasUniversalFlag) table.boolean('applies_to_all_event_types').notNullable().defaultTo(true).after('motion_type');
    });
  }
  if (!hasMotionType) {
    await knex.schema.alterTable('library_assets', (table) => {
      table.index(['type', 'motion_type'], 'library_assets_type_motion_idx');
    });
  }

  if (!(await knex.schema.hasTable('library_asset_event_types'))) {
    await knex.schema.createTable('library_asset_event_types', (table) => {
      table.bigInteger('library_asset_id').unsigned().notNullable();
      table.bigInteger('event_type_id').unsigned().notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['library_asset_id', 'event_type_id'], 'library_asset_event_types_pk');
      table.foreign('library_asset_id', 'library_asset_event_types_asset_fk').references('library_assets.id').onDelete('CASCADE');
      table.foreign('event_type_id', 'library_asset_event_types_event_type_fk').references('event_types.id').onDelete('CASCADE');
      table.index(['event_type_id', 'library_asset_id'], 'library_asset_event_types_event_type_idx');
    });
  }

  await knex('library_assets').where({ type: 'gif_overlay' }).update({ type: 'sticker', motion_type: 'animated' });
  await knex('library_assets').where({ type: 'overlay' }).update({
    type: 'sticker',
    motion_type: knex.raw("CASE WHEN LOWER(COALESCE(mime_type, '')) = 'image/gif' THEN 'animated' ELSE 'static' END"),
  });

  await knex('library_asset_categories').insert({
    slug: 'stickers',
    name: 'Stickers',
    description: 'Elementos decorativos estaticos y animados',
    is_active: true,
  }).onConflict('slug').merge();

  const importedTemplates = await knex('library_assets')
    .where({ type: 'template' })
    .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) LIKE 'template-%'")
    .select('id', knex.raw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) AS manifest_id"));
  const [framesCategory] = await knex('library_asset_categories').where({ slug: 'frames' }).select('id').limit(1);
  if (importedTemplates.length) {
    await knex('library_assets').whereIn('id', importedTemplates.map((row) => row.id)).update({
      type: 'frame',
      category_id: framesCategory?.id || null,
    });
  }

  const typeByManifest = new Map([
    ['template-boda', 'boda'],
    ['template-cumple', 'cumpleanos'],
  ]);
  for (const asset of importedTemplates) {
    const eventTypeSlug = typeByManifest.get(asset.manifest_id);
    if (!eventTypeSlug) continue;
    const [eventType] = await knex('event_types').where({ slug: eventTypeSlug, is_active: true }).select('id').limit(1);
    if (!eventType) continue;
    await knex('library_assets').where({ id: asset.id }).update({ applies_to_all_event_types: false });
    await knex('library_asset_event_types').insert({
      library_asset_id: asset.id,
      event_type_id: eventType.id,
      created_at: knex.fn.now(),
    }).onConflict(['library_asset_id', 'event_type_id']).ignore();
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasMotionType = await knex.schema.hasColumn('library_assets', 'motion_type');
  if (hasMotionType) {
    await knex('library_assets').where({ type: 'sticker', motion_type: 'animated' }).update({ type: 'gif_overlay' });
    await knex('library_assets').where({ type: 'sticker', motion_type: 'static' }).update({ type: 'overlay' });
    await knex('library_assets')
      .where({ type: 'frame' })
      .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.manifestId')) LIKE 'template-%'")
      .update({ type: 'template' });
  }
  await knex.schema.dropTableIfExists('library_asset_event_types');
  if (hasMotionType) {
    await knex.schema.alterTable('library_assets', (table) => {
      table.dropIndex(['type', 'motion_type'], 'library_assets_type_motion_idx');
      table.dropColumn('applies_to_all_event_types');
      table.dropColumn('motion_type');
    });
  }
};
