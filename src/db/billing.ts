import knex from 'knex';

export const billingDb = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
  },
  pool: { min: 0, max: 5 },
});
