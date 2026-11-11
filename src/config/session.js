'use strict';
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const env = require('./env');
const knexConfig = require('../../knexfile');

const c = knexConfig.connection;
const store = new MySQLStore({
  host: c.host,
  port: c.port,
  user: c.user,
  password: c.password,
  database: c.database,
  connectionLimit: 2,
  createDatabaseTable: false, // created by migrations
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 14 * 24 * 60 * 60 * 1000,
  schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
});

module.exports = session({
  name: 'bam.sid',
  secret: env.sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000,
  },
});
module.exports.store = store;
