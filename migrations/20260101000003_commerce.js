'use strict';

function base(t) {
  t.engine('InnoDB');
  t.charset('utf8mb4');
  t.collate('utf8mb4_unicode_ci');
}

/** Tables this migration creates. If an earlier run was interrupted, start-up drops these (only when empty) and retries. */
exports.creates = ['coupons', 'carts', 'cart_items', 'wishlists', 'delivery_zones', 'shipping_rates', 'pickup_slots', 'orders', 'order_items', 'order_status_history', 'payments', 'coupon_redemptions', 'reviews'];

exports.up = async function up(knex) {
  await knex.schema.createTable('coupons', (t) => {
    t.increments('id');
    t.string('code', 40).notNullable().unique();
    t.string('description', 190);
    t.enu('type', ['percent', 'fixed']).notNullable();
    t.integer('value').unsigned().notNullable(); // percent (1-100) or cents
    t.integer('min_spend_cents').unsigned().notNullable().defaultTo(0);
    t.dateTime('starts_at');
    t.dateTime('expires_at');
    t.integer('usage_limit').unsigned(); // NULL = unlimited
    t.integer('used_count').unsigned().notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  // Guests: the session stores the cart id. Customers: one cart per user_id.
  await knex.schema.createTable('carts', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().unique().references('users.id').onDelete('CASCADE');
    t.string('coupon_code', 40);
    t.timestamps(true, true);
    t.index(['updated_at']);
    base(t);
  });

  await knex.schema.createTable('cart_items', (t) => {
    t.increments('id');
    t.integer('cart_id').unsigned().notNullable().references('carts.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.integer('variant_id').unsigned().references('product_variants.id').onDelete('CASCADE');
    t.integer('qty').unsigned().notNullable().defaultTo(1);
    t.timestamps(true, true);
    t.index(['cart_id', 'product_id', 'variant_id']);
    base(t);
  });

  await knex.schema.createTable('wishlists', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'product_id']);
    base(t);
  });

  await knex.schema.createTable('delivery_zones', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('postal_prefixes', 1000).notNullable(); // comma separated, e.g. "L3Y,L3X"
    t.integer('fee_cents').unsigned().notNullable();
    t.integer('min_order_cents').unsigned().notNullable().defaultTo(0);
    t.integer('free_threshold_cents').unsigned(); // NULL = never free
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('shipping_rates', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.integer('min_weight_grams').unsigned().notNullable().defaultTo(0);
    t.integer('max_weight_grams').unsigned().notNullable();
    t.integer('rate_cents').unsigned().notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    base(t);
  });

  await knex.schema.createTable('pickup_slots', (t) => {
    t.increments('id');
    t.specificType('day_of_week', 'tinyint unsigned').notNullable(); // 0 = Sunday
    t.time('start_time').notNullable();
    t.time('end_time').notNullable();
    t.integer('capacity').unsigned().notNullable().defaultTo(10);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(['day_of_week', 'start_time']);
    base(t);
  });

  await knex.schema.createTable('orders', (t) => {
    t.increments('id');
    t.string('order_number', 20).notNullable().unique();
    t.specificType('access_token', 'char(40)').notNullable();
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('email', 190).notNullable().index();
    t.string('phone', 30).notNullable();
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable();
    t.enu('status', ['pending', 'awaiting_payment', 'paid', 'processing', 'ready_for_pickup',
      'out_for_delivery', 'shipped', 'completed', 'cancelled', 'refunded']).notNullable().defaultTo('pending');
    t.enu('fulfilment_method', ['pickup', 'delivery', 'shipping']).notNullable();
    t.enu('payment_method', ['stripe', 'etransfer', 'in_store']).notNullable();
    t.enu('payment_status', ['unpaid', 'paid', 'refunded']).notNullable().defaultTo('unpaid');
    t.integer('subtotal_cents').unsigned().notNullable();
    t.integer('discount_cents').unsigned().notNullable().defaultTo(0);
    t.integer('shipping_cents').unsigned().notNullable().defaultTo(0);
    t.integer('tax_cents').unsigned().notNullable().defaultTo(0);
    t.integer('total_cents').unsigned().notNullable();
    t.integer('tax_rate_bps').unsigned().notNullable(); // 1300 = 13%
    t.string('tax_label', 40).notNullable().defaultTo('HST');
    t.string('currency', 3).notNullable().defaultTo('CAD');
    t.integer('coupon_id').unsigned().references('coupons.id').onDelete('SET NULL');
    t.string('coupon_code', 40);
    // Delivery / shipping address snapshot
    t.string('ship_name', 160);
    t.string('ship_line1', 190);
    t.string('ship_line2', 190);
    t.string('ship_city', 100);
    t.string('ship_province', 2);
    t.string('ship_postal_code', 7);
    t.string('ship_country', 2);
    t.string('shipping_label', 120); // zone or rate name snapshot
    t.integer('delivery_zone_id').unsigned().references('delivery_zones.id').onDelete('SET NULL');
    // Pickup
    t.date('pickup_date');
    t.integer('pickup_slot_id').unsigned().references('pickup_slots.id').onDelete('SET NULL');
    t.string('pickup_slot_label', 60);
    t.string('tracking_carrier', 60);
    t.string('tracking_number', 80);
    t.string('customer_note', 500);
    t.text('internal_notes');
    t.string('stripe_session_id', 190).index();
    t.boolean('stock_restored').notNullable().defaultTo(false);
    t.dateTime('paid_at');
    t.timestamps(true, true);
    t.index(['status', 'created_at']);
    t.index(['user_id', 'created_at']);
    t.index(['payment_status', 'paid_at']);
    t.index(['pickup_date', 'pickup_slot_id']);
    base(t);
  });

  await knex.schema.createTable('order_items', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().references('products.id').onDelete('SET NULL');
    t.integer('variant_id').unsigned().references('product_variants.id').onDelete('SET NULL');
    // Snapshots: never change after the order is placed.
    t.string('name', 190).notNullable();
    t.string('variant_name', 120);
    t.string('sku', 64).notNullable();
    t.integer('unit_price_cents').unsigned().notNullable();
    t.integer('qty').unsigned().notNullable();
    t.integer('line_subtotal_cents').unsigned().notNullable();
    t.integer('discount_cents').unsigned().notNullable().defaultTo(0);
    t.boolean('is_taxable').notNullable();
    t.integer('tax_cents').unsigned().notNullable().defaultTo(0);
    t.integer('line_total_cents').unsigned().notNullable();
    t.integer('weight_grams').unsigned().notNullable().defaultTo(0);
    t.index(['order_id']);
    t.index(['product_id']);
    base(t);
  });

  await knex.schema.createTable('order_status_history', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.string('status', 30).notNullable();
    t.string('note', 500);
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.boolean('customer_notified').notNullable().defaultTo(false);
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['order_id', 'created_at']);
    base(t);
  });

  await knex.schema.createTable('payments', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.string('provider', 30).notNullable(); // stripe, etransfer, in_store
    t.string('provider_ref', 160);
    t.integer('amount_cents').unsigned().notNullable();
    t.string('currency', 3).notNullable().defaultTo('CAD');
    t.string('status', 30).notNullable(); // succeeded, refunded
    t.string('note', 255);
    t.integer('recorded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['order_id']);
    t.unique(['provider', 'provider_ref']);
    base(t);
  });

  await knex.schema.createTable('coupon_redemptions', (t) => {
    t.increments('id');
    t.integer('coupon_id').unsigned().notNullable().references('coupons.id').onDelete('CASCADE');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().references('users.id').onDelete('SET NULL');
    t.string('email', 190).notNullable();
    t.integer('amount_cents').unsigned().notNullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['order_id']);
    t.index(['coupon_id']);
    base(t);
  });

  await knex.schema.createTable('reviews', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.specificType('rating', 'tinyint unsigned').notNullable();
    t.string('title', 120);
    t.text('body');
    t.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    t.timestamps(true, true);
    t.unique(['product_id', 'user_id']);
    t.index(['product_id', 'status']);
    t.index(['status', 'created_at']);
    base(t);
  });
};

exports.down = async function down(knex) {
  for (const table of ['reviews', 'coupon_redemptions', 'payments', 'order_status_history', 'order_items', 'orders',
    'pickup_slots', 'shipping_rates', 'delivery_zones', 'wishlists', 'cart_items', 'carts', 'coupons']) {
    await knex.schema.dropTableIfExists(table);
  }
};
