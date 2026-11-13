'use strict';
/**
 * `npm run migrate` and `npm run seed`. Same safe path as AUTO_MIGRATE / AUTO_SEED at start-up:
 * clears a set-up lock left by an interrupted run and rebuilds half-created empty tables.
 */
require('dotenv').config({ quiet: true });
const db = require('../src/config/db');
const { prepareDatabase } = require('../src/config/setup');

const mode = process.argv[2];
const logger = { info: console.log, warn: console.warn, error: console.error };
prepareDatabase(db, { migrate: mode === 'migrate', seed: mode === 'seed', logger })
  .then(() => db.destroy())
  .catch(async (err) => {
    console.error(`\n${mode} failed: ${err.message}${err.fix ? `\nWhat to do: ${err.fix}` : ''}`);
    await db.destroy().catch(() => {});
    process.exit(1);
  });
