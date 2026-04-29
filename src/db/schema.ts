import { boolean, datetime, int, mysqlEnum, mysqlTable, primaryKey, text, varchar } from 'drizzle-orm/mysql-core';

export const postTable = mysqlTable('post', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  imageUrl: text('image_url').notNull(),
  mediaType: varchar('media_type', { length: 50 }).notNull().default('image'),
});

export const usersTable = mysqlTable('users', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  estado: mysqlEnum('estado', ['pending', 'active', 'inactive']).notNull().default('pending'),
  estadoId: int('estado_id').unsigned().notNull().default(1),
  themeMode: mysqlEnum('theme_mode', ['dark', 'light']).notNull().default('dark'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export const rolesTable = mysqlTable('roles', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
});

export const permissionsTable = mysqlTable('permissions', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  name: varchar('name', { length: 180 }).notNull(),
});

export const userRolesTable = mysqlTable(
  'user_roles',
  {
    userId: int('user_id').unsigned().notNull(),
    roleId: int('role_id').unsigned().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })]
);

export const rolePermissionsTable = mysqlTable(
  'role_permissions',
  {
    roleId: int('role_id').unsigned().notNull(),
    permissionId: int('permission_id').unsigned().notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]
);

export const refreshTokensTable = mysqlTable('refresh_tokens', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  userId: int('user_id').unsigned().notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: datetime('expires_at').notNull(),
  revoked: boolean('revoked').notNull().default(false),
});

export const passwordResetTokensTable = mysqlTable('password_reset_tokens', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  userId: int('user_id').unsigned().notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: datetime('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
});

export const bitacoraTable = mysqlTable('bitacora', {
  id: int('id').unsigned().autoincrement().primaryKey(),
  actorUserId: int('actor_user_id').unsigned(),
  actorEmail: varchar('actor_email', { length: 255 }),
  actorRoles: text('actor_roles'),
  canal: varchar('canal', { length: 32 }).notNull().default('api'),
  accion: varchar('accion', { length: 160 }).notNull(),
  entidadTipo: varchar('entidad_tipo', { length: 80 }),
  entidadId: varchar('entidad_id', { length: 80 }),
  resultado: mysqlEnum('resultado', ['success', 'fail']).notNull().default('success'),
  httpMethod: varchar('http_method', { length: 12 }).notNull(),
  httpPath: varchar('http_path', { length: 255 }).notNull(),
  httpStatus: int('http_status').notNull(),
  requestId: varchar('request_id', { length: 64 }).notNull(),
  ipHash: varchar('ip_hash', { length: 128 }),
  userAgent: varchar('user_agent', { length: 255 }),
  payloadResumen: text('payload_resumen'),
  mensaje: varchar('mensaje', { length: 255 }).notNull(),
  errorCode: varchar('error_code', { length: 80 }),
  errorDetalle: text('error_detalle'),
  createdAt: datetime('created_at').notNull(),
});
