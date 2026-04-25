require('dotenv/config');

const baseConnection = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET || 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
};

module.exports = {
  development: {
    client: 'mysql2',
    connection: baseConnection,
    pool: { min: 0, max: 10 },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
      extension: 'cjs',
    },
    seeds: {
      directory: './seeds',
      extension: 'cjs',
    },
  },
  production: {
    client: 'mysql2',
    connection: baseConnection,
    pool: { min: 2, max: 20 },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
      extension: 'cjs',
    },
    seeds: {
      directory: './seeds',
      extension: 'cjs',
    },
  },
};
