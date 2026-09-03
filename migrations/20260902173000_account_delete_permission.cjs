/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex('permissions').insert({
    slug: 'accounts.delete',
    name: 'accounts.delete',
    description: 'accounts.delete',
  }).onConflict('slug').merge();

  const [permission] = await knex('permissions').where({ slug: 'accounts.delete' }).select('id').limit(1);
  const roles = await knex('roles').whereIn('slug', ['super_admin', 'owner']).select('id');
  for (const role of roles) {
    await knex('role_permissions').insert({ role_id: role.id, permission_id: permission.id })
      .onConflict(['role_id', 'permission_id']).ignore();
  }
  const [eventDelete] = await knex('permissions').where({ slug: 'events.delete' }).select('id').limit(1);
  const [adminRole] = await knex('roles').where({ slug: 'admin' }).select('id').limit(1);
  if (eventDelete && adminRole) {
    await knex('role_permissions').insert({ role_id: adminRole.id, permission_id: eventDelete.id })
      .onConflict(['role_id', 'permission_id']).ignore();
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const [eventDelete] = await knex('permissions').where({ slug: 'events.delete' }).select('id').limit(1);
  const [adminRole] = await knex('roles').where({ slug: 'admin' }).select('id').limit(1);
  if (eventDelete && adminRole) await knex('role_permissions').where({ role_id: adminRole.id, permission_id: eventDelete.id }).delete();
  const [permission] = await knex('permissions').where({ slug: 'accounts.delete' }).select('id').limit(1);
  if (!permission) return;
  await knex('role_permissions').where({ permission_id: permission.id }).delete();
  await knex('permissions').where({ id: permission.id }).delete();
};
