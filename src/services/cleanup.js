'use strict';
const db = require('../config/db');
const { getStripe } = require('../config/stripe');
const logger = require('../config/logger');
const OrderService = require('./order');
const Paypal = require('./paypal');
const Notifications = require('./notifications');

/**
 * Housekeeping run by the hPanel cron job (GET /cron/cleanup?token=...). Each step is small and
 * bounded so it finishes quickly on shared hosting.
 */
async function run() {
  const result = {};

  // Guest carts untouched for 14 days, and saved carts untouched for 90 days.
  result.guest_carts = await db('carts').whereNull('user_id').where('updated_at', '<', db.raw('NOW() - INTERVAL 14 DAY')).limit(2000).del();
  result.stale_user_cart_items = await db('cart_items')
    .whereIn('cart_id', db('carts').whereNotNull('user_id').where('updated_at', '<', db.raw('NOW() - INTERVAL 90 DAY')).select('id'))
    .del();

  result.expired_sessions = await db('sessions').where('expires', '<', db.raw('UNIX_TIMESTAMP()')).limit(5000).del();
  result.expired_tokens = await db('user_tokens').where('expires_at', '<', db.raw('NOW() - INTERVAL 1 DAY')).del();

  // Card and PayPal orders never paid: after 2 hours ask the provider one last time, then release the stock.
  const stale = await db('orders').whereIn('payment_method', ['stripe', 'paypal']).where({ status: 'pending', payment_status: 'unpaid' })
    .where('created_at', '<', db.raw('NOW() - INTERVAL 2 HOUR')).limit(50);
  result.cancelled_unpaid_orders = 0;
  result.recovered_payments = 0;
  const stripe = getStripe();
  for (const o of stale) {
    try {
      if (o.payment_method === 'stripe' && stripe && o.stripe_session_id) {
        // Double-check with Stripe in case a webhook was missed.
        const session = await stripe.checkout.sessions.retrieve(o.stripe_session_id);
        if (session.payment_status === 'paid') {
          await OrderService.markPaidFromStripe(session);
          result.recovered_payments += 1;
          continue;
        }
        if (session.status === 'open') await stripe.checkout.sessions.expire(o.stripe_session_id).catch(() => {});
      }
      if (o.payment_method === 'paypal' && o.paypal_order_id && Paypal.isConfigured()) {
        // The customer may have approved the payment and closed the window before returning to the site.
        const pp = await Paypal.getOrder(o.paypal_order_id).catch(() => null);
        if (pp && (pp.status === 'APPROVED' || pp.status === 'COMPLETED')) {
          const outcome = await OrderService.capturePaypal(o);
          if (outcome === 'paid') { result.recovered_payments += 1; continue; }
          if (outcome === 'pending') continue;
        }
      }
      if (await OrderService.cancelUnpaidOnlineOrder(o.id, 'Payment was not completed - order cancelled automatically')) {
        result.cancelled_unpaid_orders += 1;
      }
    } catch (err) {
      logger.error(`cleanup: could not process stale order ${o.id}`, err);
    }
  }

  result.old_audit_logs = await db('audit_logs').where('created_at', '<', db.raw('NOW() - INTERVAL 365 DAY')).limit(5000).del();
  // Alerts and reminders (low-stock digest, abandoned carts, pickup and payment reminders...).
  result.notifications = await Notifications.run();
  return result;
}

module.exports = { run };
