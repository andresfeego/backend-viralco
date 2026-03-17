import { int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';

export const postTable = mysqlTable('post', {
  id: int('id').autoincrement().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  imageUrl: text('image_url').notNull(),
  mediaType: varchar('media_type', { length: 50 }).notNull().default('image'),
});
