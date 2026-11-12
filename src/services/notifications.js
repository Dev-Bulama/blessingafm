'use strict';
const db = require('../config/db');
const logger = require('../config/logger');
const Setting = require('../models/setting');
const Product = require('../models/product');
const Mail = require('./mail');
const Cart = require('./cart');
const dates = require('../lib/dates');

/**
 * Alerts and reminders. Everything here is driven by the hourly cron call, works in small bounded
 * batches, and records what it sent so nobody is emailed twice. Nothing runs until email is configured.
 */
const on = (settings, key) => Setting.isOn(settings, key);
const num = (settings, key, fallback, min, max) => {
  const n = Number(settings[key]);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Items at or below their low-stock threshold (simple products and variants). */
async function lowStockItems(limit = 40) {
  const [products, variants] = await Promise.all([
    db('products').where({ is_active: true, has_variants: false }).whereRaw('stock_qty <= low_stock_threshold')
      .select('id as product_id', 'name', 'sku', 'stock_qty', 'low_stock_threshold as threshold').orderBy('stock_qty').limit(limit),
    db('product_variants as v').join('products as p', 'p.id', 'v.product_id').where({ 'p.is_active': true, 'v.is_active': true })
      .whereRaw('v.stock_qty <= p.low_stock_threshold')
      .select('p.id as product_id', db.raw("CONCAT(p.name, ' (', v.name, ')') as name"), 'v.sku', 'v.stock_qty', 'p.low_stock_threshold as threshold')
      .orderBy('v.stock_qty').limit(limit),
  ]);
  return [...products, ...variants].sort((a, b) => a.stock_qty - b.stock_qty).slice(0, limit);
}

/** One morning email for the store: what needs doing today. Sent once per store-local day, after 7 AM. */
async function dailySummary(settings) {
  if (!on(settings, 'notify_daily_summary')) return 0;
  const today = dates.storeDate();
  if (settings.last_daily_summary_date === today || dates.storeTime() < '07:00:00') return 0;
  const yesterdayStart = dates.zonedToUtc(dates.addDays(today, -1));
  const todayStart = dates.zonedToUtc(today);
  const [counts, pickupsToday, sales, lowStock, unread, pendingReviews] = await Promise.all([
    db('orders').whereIn('status', ['pending', 'awaiting_payment', 'paid', 'processing']).groupBy('status').select('status').count({ n: 'id' }),
    db('orders').where({ fulfilment_method: 'pickup', pickup_date: today }).whereNotIn('status', ['cancelled', 'refunded', 'completed'])
      .select('id', 'order_number', 'first_name', 'last_name', 'pickup_slot_label', 'status', 'total_cents', 'payment_status').orderBy('pickup_slot_id').limit(60),
    db('orders').where({ payment_status: 'paid' }).where('paid_at', '>=', yesterdayStart).where('paid_at', '<', todayStart)
      .first(db.raw('COUNT(*) as n'), db.raw('COALESCE(SUM(total_cents), 0) as total')),
    lowStockItems(25),
    db('contact_messages').where({ is_read: false }).count({ n: 'id' }).first(),
    db('reviews').where({ status: 'pending' }).count({ n: 'id' }).first(),
  ]);
  const by = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
  const summary = {
    date: today,
    toPrepare: (by.paid || 0) + (by.processing || 0),
    paid: by.paid || 0,
    processing: by.processing || 0,
    awaitingPayment: by.awaiting_payment || 0,
    pending: by.pending || 0,
    pickupsToday,
    yesterday: { count: Number(sales.n), total: Number(sales.total) },
    lowStock,
    unreadMessages: Number(unread.n),
    pendingReviews: Number(pendingReviews.n),
  };
  if (!(await Mail.sendDailySummary(summary))) return 0;
  await Setting.setMany({ last_daily_summary_date: today });
  return 1;
}

/**
 * Abandoned cart reminder: signed-in customers only, one email per cart, and only to people we may
 * email under CASL - newsletter subscribers or customers who ordered in the last two years.
 */
async function abandonedCarts(settings) {
  if (!on(settings, 'remind_abandoned_cart')) return 0;
  const hours = num(settings, 'abandoned_cart_hours', 24, 1, 168);
  const carts = await db('carts as c').join('users as u', 'u.id', 'c.user_id')
    .where('u.is_disabled', false).where('u.marketing_opt_out', false).where('u.role', 'customer')
    .where('c.updated_at', '<', db.raw('NOW() - INTERVAL ? HOUR', [hours]))
    .where('c.updated_at', '>', db.raw('NOW() - INTERVAL 7 DAY'))
    .where((w) => w.whereNull('c.reminder_sent_at').orWhereRaw('c.reminder_sent_at < c.updated_at'))
    .whereExists(db('cart_items').whereRaw('cart_items.cart_id = c.id'))
    .where((w) => w
      .whereExists(db('newsletter_subscribers as n').whereRaw('n.email = u.email').where('n.is_subscribed', true))
      .orWhereExists(db('orders as o').whereRaw('o.user_id = u.id').where('o.created_at', '>', db.raw('NOW() - INTERVAL 24 MONTH'))))
    .select('c.id as cart_id', 'u.id', 'u.email', 'u.first_name').limit(20);
  let sent = 0;
  for (const row of carts) {
    const items = (await Cart.loadItems(row.cart_id)).filter((i) => i.purchasable && i.stock > 0);
    // Mark first so a mail failure can never cause a repeat send.
    await db('carts').where({ id: row.cart_id }).update({ reminder_sent_at: db.fn.now(), updated_at: db.ref('updated_at') });
    if (!items.length) continue;
    await Product.attachImages(items);
    const subtotal = items.reduce((n, i) => n + i.line_cents, 0);
    if (await Mail.sendAbandonedCart(row, items, subtotal)) sent += 1;
  }
  return sent;
}

/** Remind customers of a pickup that is today or tomorrow. */
async function pickupReminders(settings) {
  if (!on(settings, 'remind_pickup')) return 0;
  const today = dates.storeDate();
  const orders = await db('orders').where({ fulfilment_method: 'pickup' }).whereNull('pickup_reminder_sent_at')
    .whereIn('status', ['pending', 'paid', 'processing', 'ready_for_pickup'])
    .where((w) => w.where('payment_method', 'in_store').orWhere('payment_status', 'paid'))
    .whereBetween('pickup_date', [today, dates.addDays(today, 1)])
    .where('created_at', '<', db.raw('NOW() - INTERVAL 3 HOUR')) // no reminder straight after ordering
    .select(db.raw("orders.*, DATE_FORMAT(pickup_date, '%Y-%m-%d') as pickup_ymd")).limit(40);
  let sent = 0;
  for (const order of orders) {
    await db('orders').where({ id: order.id }).update({ pickup_reminder_sent_at: db.fn.now(), updated_at: db.ref('updated_at') });
    if (await Mail.sendPickupReminder(order, order.pickup_ymd === today)) sent += 1;
  }
  return sent;
}

/** Nudge unpaid e-Transfer orders after 24 hours; optionally cancel them after a configured time. */
async function etransferReminders(settings) {
  const result = { reminded: 0, cancelled: 0 };
  const OrderService = require('./order'); // required lazily: order.js depends on mail, which this file also uses
  const cancelHours = num(settings, 'etransfer_cancel_hours', 0, 0, 720);
  if (cancelHours > 0) {
    const stale = await db('orders').where({ payment_method: 'etransfer', status: 'awaiting_payment', payment_status: 'unpaid' })
      .where('created_at', '<', db.raw('NOW() - INTERVAL ? HOUR', [cancelHours])).select('id').limit(20);
    for (const o of stale) {
      await OrderService.changeStatus(o.id, 'cancelled', {
        system: true, notify: true, note: 'We did not receive your Interac e-Transfer in time, so this order was cancelled. You are welcome to order again.',
      });
      result.cancelled += 1;
    }
  }
  if (on(settings, 'remind_etransfer')) {
    const orders = await db('orders').where({ payment_method: 'etransfer', status: 'awaiting_payment', payment_status: 'unpaid' })
      .whereNull('payment_reminder_sent_at').where('created_at', '<', db.raw('NOW() - INTERVAL 24 HOUR')).limit(30);
    for (const order of orders) {
      await db('orders').where({ id: order.id }).update({ payment_reminder_sent_at: db.fn.now(), updated_at: db.ref('updated_at') });
      if (await Mail.sendPaymentReminder(order)) result.reminded += 1;
    }
  }
  return result;
}

/** A few days after an order is completed, invite the customer to review what they bought. */
async function reviewRequests(settings) {
  if (!on(settings, 'remind_review')) return 0;
  const days = num(settings, 'review_request_days', 5, 1, 60);
  const orders = await db('orders as o').join('users as u', 'u.id', 'o.user_id')
    .where('o.status', 'completed').whereNull('o.review_request_sent_at')
    .where('o.completed_at', '<', db.raw('NOW() - INTERVAL ? DAY', [days]))
    .where('o.completed_at', '>', db.raw('NOW() - INTERVAL 45 DAY'))
    .where('u.is_disabled', false).where('u.marketing_opt_out', false)
    .select('o.id', 'o.order_number', 'u.id as user_id', 'u.email', 'u.first_name').limit(20);
  let sent = 0;
  for (const o of orders) {
    await db('orders').where({ id: o.id }).update({ review_request_sent_at: db.fn.now(), updated_at: db.ref('updated_at') });
    const products = await db('order_items as oi').join('products as p', 'p.id', 'oi.product_id')
      .where('oi.order_id', o.id).where('p.is_active', true)
      .whereNotExists(db('reviews as r').whereRaw('r.product_id = p.id').where('r.user_id', o.user_id))
      .distinct('p.id', 'p.name', 'p.slug').limit(6);
    if (!products.length) continue;
    if (await Mail.sendReviewRequest(o, { id: o.user_id, email: o.email, first_name: o.first_name }, products)) sent += 1;
  }
  return sent;
}

/** Email people who asked to be told when a sold-out item returns. */
async function backInStock(settings) {
  if (!on(settings, 'back_in_stock_enabled')) return 0;
  const alerts = await db('stock_alerts as a').join('products as p', 'p.id', 'a.product_id')
    .leftJoin('product_variants as v', 'v.id', 'a.variant_id')
    .whereNull('a.notified_at').where('p.is_active', true)
    .whereRaw('COALESCE(v.stock_qty, p.stock_qty) > 0').where((w) => w.whereNull('v.id').orWhere('v.is_active', true))
    .select('a.id', 'a.email', 'p.slug', db.raw("IF(v.id IS NULL, p.name, CONCAT(p.name, ' (', v.name, ')')) as name")).limit(60);
  let sent = 0;
  for (const a of alerts) {
    await db('stock_alerts').where({ id: a.id }).update({ notified_at: db.fn.now() });
    if (await Mail.sendBackInStock(a.email, { name: a.name, slug: a.slug })) sent += 1;
  }
  await db('stock_alerts').whereNotNull('notified_at').where('notified_at', '<', db.raw('NOW() - INTERVAL 30 DAY')).limit(2000).del();
  return sent;
}

/** Run every reminder. Each step is isolated so one failure does not stop the others. */
async function run() {
  if (!Mail.isConfigured()) return { skipped: 'email is not configured' };
  const settings = await Setting.getAll();
  const out = {};
  const steps = { daily_summary: dailySummary, abandoned_cart_emails: abandonedCarts, pickup_reminders: pickupReminders, etransfer: etransferReminders, review_requests: reviewRequests, back_in_stock_emails: backInStock };
  for (const [name, fn] of Object.entries(steps)) {
    try {
      out[name] = await fn(settings);
    } catch (err) {
      logger.error(`notifications: ${name} failed`, err);
      out[name] = 'error';
    }
  }
  return out;
}

module.exports = { run, lowStockItems, dailySummary, abandonedCarts, pickupReminders, etransferReminders, reviewRequests, backInStock };
