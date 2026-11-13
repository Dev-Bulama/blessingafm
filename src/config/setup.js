'use strict';
const path = require('path');

/**
 * Database set-up run at start-up (AUTO_MIGRATE / AUTO_SEED) and by `npm run migrate`.
 *
 * Shared hosting can stop a process at any moment, for example while it is still creating tables.
 * That used to leave two kinds of debris that blocked every later start:
 *   1. knex's "migration in progress" flag left set, so migrations wait and give up;
 *   2. tables from a half-finished migration, so the next attempt fails with "table already exists".
 * Both are repaired here. A MySQL advisory lock (GET_LOCK) makes sure only one process ever does
 * set-up at a time, so clearing a stale flag can never interrupt a run that is really in progress.
 */
const LOCK_NAME = 'blessing_store_setup';

class SetupError extends Error {
  constructor(message, fix) {
    super(message);
    this.name = 'SetupError';
    this.code = 'BAM_SETUP';
    this.fix = fix;
  }
}

async function tableIsEmpty(db, conn, table) {
  const [rows] = await db.raw('SELECT 1 FROM ?? LIMIT 1', [table]).connection(conn);
  return rows.length === 0;
}

/**
 * Drop tables left behind by migrations that never finished. Only empty tables are dropped; if one
 * holds data we stop and say so instead of guessing.
 */
async function removeLeftovers(db, conn, pending, logger) {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  const leftovers = [];
  for (const migration of pending) {
    const file = typeof migration === 'string' ? migration : migration.file || migration.name;
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(path.join(migrationsDir, file));
    for (const table of mod.creates || []) {
      if (await db.schema.connection(conn).hasTable(table)) leftovers.push(table);
    }
  }
  if (!leftovers.length) return [];
  for (const table of leftovers) {
    if (!(await tableIsEmpty(db, conn, table))) {
      throw new SetupError(
        `The table "${table}" already contains data, but the set-up step that creates it never finished.`,
        'Use an empty database for the store, or ask for help before deleting anything.',
      );
    }
  }
  logger.warn(`Removing ${leftovers.length} empty table(s) left by an interrupted set-up: ${leftovers.join(', ')}`);
  await db.raw('SET FOREIGN_KEY_CHECKS = 0').connection(conn);
  try {
    for (const table of leftovers.reverse()) await db.raw('DROP TABLE IF EXISTS ??', [table]).connection(conn);
  } finally {
    await db.raw('SET FOREIGN_KEY_CHECKS = 1').connection(conn);
  }
  return leftovers;
}

/**
 * @param {import('knex').Knex} db
 * @param {{migrate?: boolean, seed?: boolean, logger?: object}} options
 */
async function prepareDatabase(db, { migrate = true, seed = false, logger = console } = {}) {
  const conn = await db.client.acquireConnection();
  try {
    const [[{ got }]] = await db.raw('SELECT GET_LOCK(?, 90) AS got', [LOCK_NAME]).connection(conn);
    if (Number(got) !== 1) {
      throw new SetupError('Another copy of the store is still setting up the database.', 'Wait a minute. This page will refresh by itself.');
    }
    try {
      if (migrate) {
        // We hold the advisory lock, so any "migration in progress" flag is left over from a process
        // that was stopped part-way. Clear it.
        if (await db.schema.connection(conn).hasTable('knex_migrations_lock')) {
          const [rows] = await db.raw('SELECT is_locked FROM knex_migrations_lock').connection(conn);
          if (rows.some((r) => Number(r.is_locked) === 1)) {
            logger.warn('Clearing a database set-up lock left by an interrupted start.');
            await db.raw('UPDATE knex_migrations_lock SET is_locked = 0').connection(conn);
          }
        }
        const [, pending] = await db.migrate.list();
        if (pending.length) await removeLeftovers(db, conn, pending, logger);
        const [batch, files] = await db.migrate.latest();
        logger.info(files.length ? `Database tables created/updated (batch ${batch}): ${files.join(', ')}` : 'Database tables are up to date');
      }
      if (seed) {
        await db.seed.run();
        logger.info('Starter data loaded. You can set AUTO_SEED=0 now.');
      }
    } finally {
      await db.raw('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).connection(conn).catch(() => {});
    }
  } finally {
    await db.client.releaseConnection(conn);
  }
}

module.exports = { prepareDatabase, SetupError, LOCK_NAME };
