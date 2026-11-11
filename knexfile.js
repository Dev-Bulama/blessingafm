'use strict';
require('dotenv').config({ quiet: true });

/** Knex configuration shared by the app, migrations and seeds. */
module.exports = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: false,
    decimalNumbers: true,
  },
  pool: {
    min: 0,
    max: Math.min(Number(process.env.DB_POOL_MAX || 3), 5),
    idleTimeoutMillis: 30000,
  },
  migrations: { directory: './migrations', tableName: 'knex_migrations' },
  seeds: { directory: './seeds' },
};
