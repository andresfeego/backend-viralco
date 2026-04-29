const bcrypt = require('bcryptjs');

const ROLE_ROWS = [
  { slug: 'super_admin', name: 'Super Admin' },
  { slug: 'admin', name: 'Administrador' },
  { slug: 'operario', name: 'Operario' },
  { slug: 'cliente', name: 'Cliente' },
];

const PERMISSION_ROWS = [
  { slug: 'auth.login', name: 'Auth Login' },
  { slug: 'auth.register', name: 'Auth Register' },
  { slug: 'profile.view', name: 'Profile View' },
  { slug: 'profile.update', name: 'Profile Update' },
  { slug: 'users.view', name: 'Users View' },
  { slug: 'users.create', name: 'Users Create' },
  { slug: 'users.update', name: 'Users Update' },
  { slug: 'users.delete', name: 'Users Delete' },
  { slug: 'roles.view', name: 'Roles View' },
  { slug: 'roles.assign', name: 'Roles Assign' },
  { slug: 'permissions.view', name: 'Permissions View' },
  { slug: 'permissions.assign', name: 'Permissions Assign' },
  { slug: 'events.view', name: 'Events View' },
  { slug: 'events.create', name: 'Events Create' },
  { slug: 'events.update', name: 'Events Update' },
  { slug: 'events.delete', name: 'Events Delete' },
  { slug: 'capture.operate', name: 'Capture Operate' },
  { slug: 'portal.view', name: 'Portal View' },
  { slug: 'devices.view', name: 'Devices View' },
  { slug: 'devices.manage', name: 'Devices Manage' },
];

const ROLE_PERMISSIONS = {
  super_admin: PERMISSION_ROWS.map((permission) => permission.slug),
  admin: [
    'auth.login',
    'auth.register',
    'profile.view',
    'profile.update',
    'users.view',
    'users.create',
    'users.update',
    'events.view',
    'events.create',
    'events.update',
    'capture.operate',
    'portal.view',
    'devices.view',
  ],
  operario: ['auth.login', 'profile.view', 'events.view', 'capture.operate', 'devices.view'],
  cliente: ['auth.login', 'profile.view', 'portal.view'],
};

const SUPER_ADMIN_EMAIL = 'superadmin@viralco.local';
const SUPER_ADMIN_PASSWORD = 'ViralCo_SA_2026!';
const ACTIVE_ADMIN_EMAIL = 'admin.active@viralco.local';
const ACTIVE_ADMIN_PASSWORD = 'ViralCo_Admin_2026!';
const PENDING_ADMIN_EMAIL = 'admin.pending@viralco.local';
const PENDING_ADMIN_PASSWORD = 'ViralCo_Pending_2026!';

/**
 * @param {import('knex').Knex} knex
 */
exports.seed = async function seed(knex) {
  for (const role of ROLE_ROWS) {
    await knex('roles').insert(role).onConflict('slug').ignore();
  }

  for (const permission of PERMISSION_ROWS) {
    await knex('permissions').insert(permission).onConflict('slug').ignore();
  }

  const roleRows = await knex('roles').select('id', 'slug');
  const permissionRows = await knex('permissions').select('id', 'slug');

  const roleBySlug = Object.fromEntries(roleRows.map((row) => [row.slug, row]));
  const permissionBySlug = Object.fromEntries(permissionRows.map((row) => [row.slug, row]));

  for (const [roleSlug, permissionSlugs] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleBySlug[roleSlug];
    if (!role) {
      continue;
    }

    for (const permissionSlug of permissionSlugs) {
      const permission = permissionBySlug[permissionSlug];
      if (!permission) {
        continue;
      }

      await knex('role_permissions')
        .insert({ role_id: role.id, permission_id: permission.id })
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }

  const now = new Date();
  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
  const activeAdminHashedPassword = await bcrypt.hash(ACTIVE_ADMIN_PASSWORD, 12);
  const pendingAdminHashedPassword = await bcrypt.hash(PENDING_ADMIN_PASSWORD, 12);

  await knex('users')
    .insert({
      email: SUPER_ADMIN_EMAIL,
      password: hashedPassword,
      estado: 'active',
      estado_id: 2,
      created_at: now,
      updated_at: now,
    })
    .onConflict('email')
    .ignore();

  await knex('users')
    .insert({
      email: ACTIVE_ADMIN_EMAIL,
      password: activeAdminHashedPassword,
      estado: 'active',
      estado_id: 2,
      created_at: now,
      updated_at: now,
    })
    .onConflict('email')
    .ignore();

  await knex('users')
    .insert({
      email: PENDING_ADMIN_EMAIL,
      password: pendingAdminHashedPassword,
      estado: 'pending',
      estado_id: 1,
      created_at: now,
      updated_at: now,
    })
    .onConflict('email')
    .ignore();

  const superAdminUser = await knex('users').where({ email: SUPER_ADMIN_EMAIL }).first();
  const activeAdminUser = await knex('users').where({ email: ACTIVE_ADMIN_EMAIL }).first();
  const pendingAdminUser = await knex('users').where({ email: PENDING_ADMIN_EMAIL }).first();
  const superAdminRole = roleBySlug.super_admin;
  const adminRole = roleBySlug.admin;

  if (superAdminUser && superAdminRole) {
    await knex('user_roles')
      .insert({ user_id: superAdminUser.id, role_id: superAdminRole.id })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  }

  if (pendingAdminUser && adminRole) {
    await knex('user_roles')
      .insert({ user_id: pendingAdminUser.id, role_id: adminRole.id })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  }

  if (activeAdminUser && adminRole) {
    await knex('user_roles')
      .insert({ user_id: activeAdminUser.id, role_id: adminRole.id })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  }
};
