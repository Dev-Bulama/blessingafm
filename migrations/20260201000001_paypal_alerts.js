'use strict';

const NEW_SETTINGS = {
  payment_paypal_enabled: '1',
  notify_low_stock: '1',
  notify_daily_summary: '1',
  remind_abandoned_cart: '1',
  abandoned_cart_hours: '24',
  remind_pickup: '1',
  remind_etransfer: '1',
  etransfer_cancel_hours: '0',
  remind_review: '1',
  review_request_days: '5',
  back_in_stock_enabled: '1',
  last_daily_summary_date: '',
};

exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE orders MODIFY payment_method ENUM('stripe','paypal','etransfer','in_store') NOT NULL");
  await knex.schema.alterTable('orders', (t) => {
    t.string('paypal_order_id', 64).index();
    t.dateTime('pickup_reminder_sent_at');
    t.dateTime('payment_reminder_sent_at');
    t.dateTime('review_request_sent_at');
    t.dateTime('completed_at').index();
  });
  await knex('orders').where({ status: 'completed' }).whereNull('completed_at').update({ completed_at: knex.ref('updated_at') });

  await knex.schema.alterTable('carts', (t) => {
    t.dateTime('reminder_sent_at');
  });
  await knex.schema.alterTable('users', (t) => {
    t.boolean('marketing_opt_out').notNullable().defaultTo(false);
  });

  // "Email me when this is back in stock" requests.
  await knex.schema.createTable('stock_alerts', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.integer('variant_id').unsigned().references('product_variants.id').onDelete('CASCADE');
    t.string('email', 190).notNullable();
    t.dateTime('notified_at');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['product_id', 'variant_id', 'notified_at']);
    t.index(['email']);
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  });

  await knex('settings').insert(Object.entries(NEW_SETTINGS).map(([key, value]) => ({ key, value }))).onConflict('key').ignore();
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('stock_alerts');
  await knex.schema.alterTable('users', (t) => t.dropColumn('marketing_opt_out'));
  await knex.schema.alterTable('carts', (t) => t.dropColumn('reminder_sent_at'));
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('paypal_order_id');
    t.dropColumn('pickup_reminder_sent_at');
    t.dropColumn('payment_reminder_sent_at');
    t.dropColumn('review_request_sent_at');
    t.dropColumn('completed_at');
  });
  await knex('orders').where({ payment_method: 'paypal' }).update({ payment_method: 'stripe' });
  await knex.raw("ALTER TABLE orders MODIFY payment_method ENUM('stripe','etransfer','in_store') NOT NULL");
  await knex('settings').whereIn('key', Object.keys(NEW_SETTINGS)).del();
};
