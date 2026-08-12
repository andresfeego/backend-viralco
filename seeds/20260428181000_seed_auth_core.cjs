const USER_STATUSES = [
  { slug: 'pending', name: 'Pendiente', description: 'Pendiente de aprobacion' },
  { slug: 'active', name: 'Activo', description: 'Acceso habilitado' },
  { slug: 'suspended', name: 'Suspendido', description: 'Acceso revocado temporalmente' },
];

const ROLE_ROWS = [
  { slug: 'super_admin', name: 'Super Admin', description: 'Administracion global de plataforma' },
  { slug: 'owner', name: 'Propietario', description: 'Propietario de una cuenta' },
  { slug: 'admin', name: 'Administrador', description: 'Administracion dentro de una cuenta' },
  { slug: 'operario', name: 'Operario', description: 'Operacion de eventos y dispositivos' },
  { slug: 'cliente', name: 'Cliente', description: 'Acceso al portal y entregas' },
];

const PERMISSION_ROWS = [
  'auth.login', 'auth.register', 'profile.view', 'profile.update',
  'users.view', 'users.create', 'users.update', 'users.delete',
  'accounts.view', 'accounts.create', 'accounts.update', 'accounts.members.manage',
  'subscriptions.view', 'subscriptions.manage',
  'library.view', 'library.manage', 'library.global.manage',
  'roles.view', 'roles.assign', 'permissions.view', 'permissions.assign',
  'events.view', 'events.create', 'events.update', 'events.delete', 'events.resources.manage',
  'capture.operate', 'portal.view', 'devices.view', 'devices.manage',
].map((slug) => ({ slug, name: slug, description: slug }));

const ROLE_PERMISSIONS = {
  super_admin: PERMISSION_ROWS.map((permission) => permission.slug),
  owner: PERMISSION_ROWS.filter((permission) => !['accounts.create', 'library.global.manage'].includes(permission.slug)).map((permission) => permission.slug),
  admin: [
    'auth.login', 'profile.view', 'profile.update', 'users.view', 'users.create', 'users.update',
    'accounts.view', 'accounts.update', 'accounts.members.manage', 'subscriptions.view',
    'library.view', 'library.manage', 'events.view', 'events.create', 'events.update',
    'events.resources.manage', 'capture.operate', 'portal.view', 'devices.view',
  ],
  operario: ['auth.login', 'profile.view', 'accounts.view', 'library.view', 'events.view', 'capture.operate', 'devices.view'],
  cliente: ['auth.login', 'profile.view', 'accounts.view', 'library.view', 'events.view', 'portal.view'],
};

/** @param {import('knex').Knex} knex */
exports.seed = async function seed(knex) {
  for (const status of USER_STATUSES) await knex('user_statuses').insert(status).onConflict('slug').merge();
  for (const role of ROLE_ROWS) await knex('roles').insert(role).onConflict('slug').merge();
  for (const permission of PERMISSION_ROWS) await knex('permissions').insert(permission).onConflict('slug').merge();

  const roleRows = await knex('roles').select('id', 'slug');
  const permissionRows = await knex('permissions').select('id', 'slug');
  const roleBySlug = Object.fromEntries(roleRows.map((row) => [row.slug, row]));
  const permissionBySlug = Object.fromEntries(permissionRows.map((row) => [row.slug, row]));

  for (const [roleSlug, permissionSlugs] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleBySlug[roleSlug];
    if (!role) continue;
    for (const permissionSlug of permissionSlugs) {
      const permission = permissionBySlug[permissionSlug];
      if (!permission) continue;
      await knex('role_permissions')
        .insert({ role_id: role.id, permission_id: permission.id })
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }
};
