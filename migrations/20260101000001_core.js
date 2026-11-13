'use strict';

/** Tables this migration creates. If an earlier run was interrupted, start-up drops these (only when empty) and retries. */
exports.creates = ['users', 'user_tokens', 'addresses', 'settings', 'sessions', 'audit_logs'];

exports.up = async function up(knex) {
  await knex.raw('SET NAMES utf8mb4');

  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('email', 190).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable();
    t.string('phone', 30);
    t.enu('role', ['customer', 'staff', 'admin']).notNullable().defaultTo('customer').index();
    t.dateTime('email_verified_at');
    t.boolean('is_disabled').notNullable().defaultTo(false);
    t.dateTime('last_login_at');
    t.timestamps(true, true);
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  });

  await knex.schema.createTable('user_tokens', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.enu('type', ['verify', 'reset']).notNullable();
    t.specificType('token_hash', 'char(64)').notNullable().unique();
    t.dateTime('expires_at').notNullable();
    t.dateTime('used_at');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'type']);
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  });

  await knex.schema.createTable('addresses', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('label', 60);
    t.string('full_name', 160).notNullable();
    t.string('phone', 30);
    t.string('line1', 190).notNullable();
    t.string('line2', 190);
    t.string('city', 100).notNullable();
    t.string('province', 2).notNullable().defaultTo('ON');
    t.string('postal_code', 7).notNullable();
    t.string('country', 2).notNullable().defaultTo('CA');
    t.boolean('is_default').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  });

  await knex.schema.createTable('settings', (t) => {
    t.string('key', 80).primary();
    t.text('value');
    t.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  });

  // Layout expected by express-mysql-session.
  await knex.schema.createTable('sessions', (t) => {
    t.string('session_id', 128).primary();
    t.integer('expires').unsigned().notNullable().index();
    t.specificType('data', 'mediumtext');
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_bin');
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('action', 60).notNullable();
    t.string('entity', 60).index();
    t.string('entity_id', 60);
    t.text('details');
    t.string('ip', 45);
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now()).index();
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  });
};

exports.down = async function down(knex) {
  for (const table of ['audit_logs', 'sessions', 'settings', 'addresses', 'user_tokens', 'users']) {
    await knex.schema.dropTableIfExists(table);
  }
};
