'use strict';
require('dotenv').config({ quiet: true });
const http = require('http');

/**
 * Entry file. The HTTP server starts listening immediately, before the database is touched, so the
 * host always gets an answer. If setup fails (wrong database password, missing setting...) visitors
 * see a short "setting up" page that names the problem, and the app keeps retrying on its own.
 *
 * Optional first-run helpers for hosts without a terminal:
 *   AUTO_MIGRATE=1  apply pending database migrations before the app starts
 *   AUTO_SEED=1     run the (idempotent) seeds; set for the first deploy only, then remove
 */
const RETRY_MS = 20000;
const port = Number(process.env.PORT) || 3000;
let app = null;
let problem = { title: 'Starting up', detail: 'The store is starting. This page refreshes by itself.', fix: '' };
let logger = { info: (m) => console.log(m), error: (m, e) => console.error(m, e || '') };

/** Turn a startup error into plain words. Never includes passwords, user names or host names. */
function explain(err) {
  const code = err && (err.code || err.errno);
  const msg = String((err && err.message) || err);
  const db = (detail, fix) => ({ title: 'Database connection problem', detail, fix });
  if (code === 'ER_ACCESS_DENIED_ERROR') return db('MySQL refused the user name or password.', 'Check DB_USER and DB_PASSWORD. DB_USER must be the full name from hPanel > Databases, including the prefix (for example u123456789_name).');
  if (code === 'ER_DBACCESS_DENIED_ERROR') return db('The database user is not allowed to use this database.', 'Check DB_NAME, and that the user is assigned to that database in hPanel > Databases.');
  if (code === 'ER_BAD_DB_ERROR') return db('The database named in DB_NAME does not exist.', 'Check DB_NAME. It must be the full name from hPanel > Databases, including the prefix.');
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || /Knex: Timeout acquiring a connection/.test(msg)) {
    return db('The database server could not be reached.', 'Check DB_HOST (try 127.0.0.1, or localhost) and DB_PORT (3306).');
  }
  if (/DB_NAME|database.*not.*(set|specified)|No database selected/i.test(msg)) return db('No database name is set.', 'Set DB_NAME, DB_USER and DB_PASSWORD.');
  if (/ADMIN_EMAIL|ADMIN_PASSWORD/.test(msg)) return { title: 'Admin login not set up', detail: msg.replace(/^.*seed:\s*/s, ''), fix: 'Fix ADMIN_EMAIL / ADMIN_PASSWORD (password at least 10 characters), then redeploy.' };
  if (/SESSION_SECRET/.test(msg)) return { title: 'SESSION_SECRET is missing', detail: msg, fix: 'Set SESSION_SECRET to a long random string.' };
  if (code === 'EACCES' || code === 'EROFS' || code === 'ENOENT' || code === 'ENOTDIR') return { title: 'A folder cannot be written', detail: 'The app could not create or write to a folder it needs.', fix: 'Check UPLOAD_DIR and LOG_DIR, or leave them out to use folders inside the app.' };
  if (code === 'MODULE_NOT_FOUND') return { title: 'Dependencies are not installed', detail: 'A required package is missing.', fix: 'Run the install step again (npm install) and redeploy.' };
  return { title: 'Setup problem', detail: `The app could not finish starting${code ? ` (${code})` : ''}.`, fix: 'Check the environment variables, then redeploy. The full error is in the app log.' };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function setupPage(res) {
  const p = problem;
  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '20', 'X-Robots-Tag': 'noindex' });
  res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="20"><title>Store is being set up</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#FFD400;color:#111"><div style="max-width:560px;margin:10vh auto;padding:28px;background:#fff;border:4px solid #111">
<h1 style="margin:0 0 8px;color:#D81E1E">We will be open shortly</h1><p>The store is being set up. Please check back in a few minutes.</p>
<hr><p style="font-size:14px"><strong>For the site owner - ${esc(p.title)}</strong><br>${esc(p.detail)}${p.fix ? `<br><br><strong>What to do:</strong> ${esc(p.fix)}` : ''}</p>
<p style="font-size:12px;color:#555">This page retries every 20 seconds and disappears once the problem is fixed.</p></div></body></html>`);
}

const server = http.createServer((req, res) => {
  if (app) return app(req, res);
  if (req.url === '/healthz') { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end(`not ready: ${problem.title}`); }
  return setupPage(res);
});
server.on('error', (err) => {
  console.error('HTTP server error', err);
  process.exit(1);
});
server.listen(port, () => logger.info(`Listening on port ${port}; preparing the store...`));

async function boot() {
  try {
    require('./src/config/env'); // validates required settings
    logger = require('./src/config/logger');
    const db = require('./src/config/db');
    await db.raw('SELECT 1');
    if (process.env.AUTO_MIGRATE === '1') {
      const [batch, files] = await db.migrate.latest();
      logger.info(files.length ? `Migrations applied (batch ${batch}): ${files.join(', ')}` : 'Database schema is up to date');
    }
    if (!(await db.schema.hasTable('settings'))) {
      throw Object.assign(new Error('tables missing'), { code: 'BAM_NO_TABLES' });
    }
    if (process.env.AUTO_SEED === '1') {
      await db.seed.run();
      logger.info('Seeds finished. Set AUTO_SEED=0 in the environment now.');
    }
    app = require('./src/app');
    logger.info(`Blessing African Market is ready on port ${port} (${process.env.NODE_ENV || 'development'})`);
  } catch (err) {
    problem = err && err.code === 'BAM_NO_TABLES'
      ? { title: 'The database is empty', detail: 'The database connection works, but the tables have not been created yet.', fix: 'Set AUTO_MIGRATE=1 and AUTO_SEED=1 and redeploy (or run "npm run migrate" and "npm run seed").' }
      : explain(err);
    logger.error(`Startup problem: ${problem.title} - ${problem.detail}`, err);
    setTimeout(boot, RETRY_MS).unref();
  }
}
boot();

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    try { require('./src/config/db').destroy().finally(() => process.exit(0)); } catch (err) { process.exit(0); }
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err));
process.on('uncaughtException', (err) => {
  // Log and keep serving: one bad request must not take the whole store down.
  logger.error('Uncaught exception', err);
});
