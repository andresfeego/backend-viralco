const bcrypt = require('bcryptjs');

const DEMO_USERS = [
  { email: 'superadmin@viralco.local', password: 'superadmin1234', name: 'Super Admin', phone: '3000000001', status: 'active', globalRole: 'super_admin' },
  { email: 'adminuseractivo@viralco.local', password: 'adminuseractivo1234', name: 'Admin User Activo', phone: '3000000002', status: 'active' },
  { email: 'useradminpendiente@viralco.local', password: 'useradminpendiente1234', name: 'User Admin Pendiente', phone: '3000000003', status: 'pending' },
];

/** @param {import('knex').Knex} knex */
exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production' || process.env.SEED_DEMO_USERS !== 'true') return;
  const statuses = Object.fromEntries((await knex('user_statuses').select('id', 'slug')).map((row) => [row.slug, row.id]));
  const roles = Object.fromEntries((await knex('roles').select('id', 'slug')).map((row) => [row.slug, row.id]));

  for (const user of DEMO_USERS) {
    const password = await bcrypt.hash(user.password, 12);
    await knex('users')
      .insert({
        email: user.email,
        password,
        name: user.name,
        phone: user.phone,
        status_id: statuses[user.status],
        theme_mode: 'dark',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .onConflict('email')
      .merge({ password, name: user.name, phone: user.phone, status_id: statuses[user.status], updated_at: knex.fn.now() });

    if (user.globalRole) {
      const created = await knex('users').where({ email: user.email }).first();
      await knex('user_roles')
        .insert({ user_id: created.id, role_id: roles[user.globalRole] })
        .onConflict(['user_id', 'role_id'])
        .ignore();
    }
  }
};
