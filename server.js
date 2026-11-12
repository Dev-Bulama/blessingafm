'use strict';
require('dotenv').config({ quiet: true });

const env = require('./src/config/env');
const logger = require('./src/config/logger');
const db = require('./src/config/db');

/**
 * Optional first-run helpers for hosts without a terminal:
 *   AUTO_MIGRATE=1  apply pending database migrations before the app starts
 *   AUTO_SEED=1     run the (idempotent) seeds; set for the first deploy only, then remove
 */
async function prepareDatabase() {
  if (process.env.AUTO_MIGRATE === '1') {
    const [batch, files] = await db.migrate.latest();
    logger.info(files.length ? `Migrations applied (batch ${batch}): ${files.join(', ')}` : 'Database schema is up to date');
  }
  if (process.env.AUTO_SEED === '1') {
    await db.seed.run();
    logger.info('Seeds finished. Remove AUTO_SEED from the environment now.');
  }
}

let server;
prepareDatabase()
  .then(() => {
    const app = require('./src/app');
    server = app.listen(env.port, () => {
      logger.info(`Blessing African Market listening on port ${env.port} (${env.nodeEnv})`);
    });
  })
  .catch((err) => {
    logger.error('Startup failed', err);
    process.exit(1);
  });

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  if (!server) process.exit(0);
  server.close(() => {
    db.destroy().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err));
