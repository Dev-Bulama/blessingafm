'use strict';
require('dotenv').config({ quiet: true });

const env = require('./src/config/env');
const logger = require('./src/config/logger');
const app = require('./src/app');

const server = app.listen(env.port, () => {
  logger.info(`Blessing African Market listening on port ${env.port} (${env.nodeEnv})`);
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    require('./src/config/db').destroy().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err));
