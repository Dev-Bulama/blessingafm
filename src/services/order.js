'use strict';
const crypto = require('crypto');
const db = require('../config/db');
const env = require('../config/env');
const logger = require('../config/logger');
const Order = require('../models/order');
const Cart = require('./cart');
const Checkout = require('./checkout');
const Inventory = require('./inventory');
const Mail = require('./mail');
const { getStripe } = require('../config/stripe');
const Paypal = require('./paypal');
const Setting = require('../models/setting');
const { formatPostal } = require('./shipping');

class CheckoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutError';
    this.status = 400;
    this.expose = true;
  }
}

const itemLabel = (i) => (i.variant_name ? `${i.name} (${i.variant_name})` : i.name);

/**
 * Create an order from the visitor's cart. Everything happens in one transaction: prices are
 * re-read from the database, totals recomputed, stock decremented with guarded updates and the
 * coupon usage counted. If any step fails nothing is written.
 */
async function placeOrder({ req, input, settings }) {
  const cartId = await Cart.findCartId(req);
  if (!cartId) throw new CheckoutError('Your cart is empty.');
  const opts = Checkout.options(settings);
  if (!opts.fulfilment[input.fulfilment]) throw new CheckoutError('That fulfilment method is not available right now.');
  if (!Checkout.paymentAllowed(input.payment_method, input.fulfilment, opts)) {
    throw new CheckoutError('That payment method is not available for this order.');
  }

  const lowStock = [];
  const orderId = await db.transaction(async (trx) => {
    const cart = await trx('carts').where({ id: cartId }).forUpdate().first();
    const items = await Cart.loadItems(cartId, trx);
    if (!items.length) throw new CheckoutError('Your cart is empty.');
    const unavailable = items.find((i) => !i.purchasable);
    if (unavailable) throw new CheckoutError(`${itemLabel(unavailable)} is no longer available. Please remove it from your cart.`);

    const postal = input.fulfilment === 'pickup' ? '' : input.address.postal_code;
    const q = await Checkout.quote({ items, couponCode: cart.coupon_code, fulfilment: input.fulfilment, postalCode: postal, settings, trx });
    if (q.blockers.length) {
      throw new CheckoutError(`${q.errors[0]} Affected: ${q.blockers.map((b) => `${b.name} (${b.reasons.join(', ')})`).join('; ')}.`);
    }
    if (!q.ok) throw new CheckoutError(q.errors[0]);
    if (cart.coupon_code && q.coupon_error) {
      await trx('carts').where({ id: cartId }).update({ coupon_code: null });
      throw new CheckoutError(`${q.coupon_error} The coupon has been removed from your cart.`);
    }

    // Pickup slot: lock the slot row so concurrent checkouts cannot overfill it.
    let pickup = { pickup_date: null, pickup_slot_id: null, pickup_slot_label: null };
    if (input.fulfilment === 'pickup') {
      await trx('pickup_slots').where({ id: input.pickup_slot_id }).forUpdate().first('id');
      const days = await Checkout.pickupOptions(settings, trx);
      const day = days.find((d) => d.date === input.pickup_date);
      const slot = day && day.slots.find((s) => s.id === input.pickup_slot_id);
      if (!slot) throw new CheckoutError('That pickup time is no longer available. Please choose another slot.');
      pickup = { pickup_date: day.date, pickup_slot_id: slot.id, pickup_slot_label: slot.label };
    }

    // Coupon usage: a guarded increment so a limited coupon can never be over-redeemed.
    if (q.coupon) {
      const ok = await trx('coupons').where({ id: q.coupon.id })
        .where((qb) => qb.whereNull('usage_limit').orWhereRaw('used_count < usage_limit'))
        .increment('used_count', 1);
      if (!ok) throw new CheckoutError('This coupon has reached its usage limit.');
    }

    const t = q.totals;
    const withAddress = input.fulfilment !== 'pickup';
    const [id] = await trx('orders').insert({
      order_number: `TMP-${crypto.randomBytes(6).toString('hex')}`,
      access_token: crypto.randomBytes(20).toString('hex'),
      user_id: req.user ? req.user.id : null,
      email: input.email,
      phone: input.phone,
      first_name: input.first_name,
      last_name: input.last_name,
      status: input.payment_method === 'etransfer' ? 'awaiting_payment' : 'pending',
      fulfilment_method: input.fulfilment,
      payment_method: input.payment_method,
      subtotal_cents: t.subtotal_cents,
      discount_cents: t.discount_cents,
      shipping_cents: t.shipping_cents,
      tax_cents: t.tax_cents,
      total_cents: t.total_cents,
      tax_rate_bps: t.tax_rate_bps,
      tax_label: settings.tax_label || 'HST',
      coupon_id: q.coupon ? q.coupon.id : null,
      coupon_code: q.coupon ? q.coupon.code : null,
      ship_name: withAddress ? input.address.name : null,
      ship_line1: withAddress ? input.address.line1 : null,
      ship_line2: withAddress ? input.address.line2 || null : null,
      ship_city: withAddress ? input.address.city : null,
      ship_province: withAddress ? input.address.province : null,
      ship_postal_code: withAddress ? formatPostal(input.address.postal_code) : null,
      ship_country: withAddress ? 'CA' : null,
      shipping_label: q.shipping_label,
      delivery_zone_id: q.zone ? q.zone.id : null,
      ...pickup,
      customer_note: input.note || null,
    });
    const orderNumber = `BAM-${100000 + id}`;
    await trx('orders').where({ id }).update({ order_number: orderNumber });

    await trx('order_items').insert(t.lines.map((l) => ({
      order_id: id,
      product_id: l.product_id,
      variant_id: l.variant_id,
      name: l.name,
      variant_name: l.variant_name,
      sku: l.sku,
      unit_price_cents: l.unit_price_cents,
      qty: l.qty,
      line_subtotal_cents: l.line_subtotal_cents,
      discount_cents: l.discount_cents,
      is_taxable: l.is_taxable,
      tax_cents: l.tax_cents,
      line_total_cents: l.line_total_cents,
      weight_grams: l.weight_grams,
    })));

    // Take stock. Sorted by id so concurrent orders always lock rows in the same order.
    const sorted = [...items].sort((a, b) => a.product_id - b.product_id || (a.variant_id || 0) - (b.variant_id || 0));
    for (const item of sorted) {
      const after = await Inventory.adjust(trx, {
        productId: item.product_id, variantId: item.variant_id, delta: -item.qty, reason: 'order',
        note: orderNumber, orderId: id, userId: req.user ? req.user.id : null, label: itemLabel(item),
      });
      const { low_stock_threshold: threshold } = await trx('products').where({ id: item.product_id }).first('low_stock_threshold');
      if (Inventory.crossedLowStock(after + item.qty, after, threshold)) {
        lowStock.push({ product_id: item.product_id, name: itemLabel(item), sku: item.sku, stock_qty: after, threshold });
      }
      await trx('products').where({ id: item.product_id }).increment('sales_count', item.qty);
    }

    if (q.coupon) {
      await trx('coupon_redemptions').insert({
        coupon_id: q.coupon.id, order_id: id, user_id: req.user ? req.user.id : null, email: input.email, amount_cents: t.discount_cents,
      });
    }
    await trx('order_status_history').insert({
      order_id: id, status: input.payment_method === 'etransfer' ? 'awaiting_payment' : 'pending', note: 'Order placed', customer_notified: true,
    });
    await Cart.clear(cartId, trx);
    return id;
  });

  const order = await Order.findById(orderId);
  // Card and PayPal orders are confirmed by email once the payment itself is confirmed.
  if (!Order.ONLINE_METHODS.includes(order.payment_method)) notifyPlaced(order);
  if (lowStock.length && Setting.isOn(settings, 'notify_low_stock')) {
    Mail.sendLowStockAlert(lowStock, order).catch((err) => logger.error('low stock email failed', err));
  }
  return order;
}

function notifyPlaced(order) {
  Mail.sendOrderConfirmation(order).catch((err) => logger.error('order confirmation email failed', err));
  Mail.sendStoreNewOrder(order).catch((err) => logger.error('store notification email failed', err));
}

/** Return an order's items to stock (once only). */
async function restock(trx, order, userId) {
  if (order.stock_restored) return;
  const items = await trx('order_items').where({ order_id: order.id }).orderBy(['product_id', 'variant_id']);
  for (const item of items) {
    if (!item.product_id) continue; // product was deleted since
    const variantStillExists = item.variant_id || !(await trx('products').where({ id: item.product_id, has_variants: true }).first('id'));
    if (!variantStillExists) continue;
    await Inventory.adjust(trx, {
      productId: item.product_id, variantId: item.variant_id, delta: item.qty, reason: 'restock',
      note: `${order.order_number} cancelled`, orderId: order.id, userId,
    });
    await trx('products').where({ id: item.product_id }).update({ sales_count: trx.raw('GREATEST(CAST(sales_count AS SIGNED) - ?, 0)', [item.qty]) });
  }
  await trx('orders').where({ id: order.id }).update({ stock_restored: true });
}

/**
 * Move an order to a new status, with side effects: payment bookkeeping, restock on cancel,
 * status history and (optionally) a customer email.
 */
async function changeStatus(orderId, status, { userId = null, note = '', notify = true, system = false, paymentRef = null } = {}) {
  if (!Order.STATUSES.includes(status)) throw new CheckoutError('Unknown status.');
  const changed = await db.transaction(async (trx) => {
    const order = await trx('orders').where({ id: orderId }).forUpdate().first();
    if (!order) throw new CheckoutError('Order not found.');
    if (order.status === status) return false;
    if (!system && !Order.nextStatuses(order).includes(status)) {
      throw new CheckoutError(`An order that is "${Order.STATUS_LABELS[order.status]}" cannot be moved to "${Order.STATUS_LABELS[status]}".`);
    }
    const update = { status };
    if (status === 'completed') update.completed_at = new Date();
    // "Paid" is recorded when staff confirm an e-Transfer, and automatically when a
    // pay-in-store order is completed (the customer paid at the counter).
    const becomesPaid = order.payment_status === 'unpaid'
      && (status === 'paid' || (status === 'completed' && order.payment_method === 'in_store'));
    if (becomesPaid) {
      update.payment_status = 'paid';
      update.paid_at = new Date();
      await trx('payments').insert({
        order_id: order.id, provider: order.payment_method, provider_ref: paymentRef || `manual-${order.id}`,
        amount_cents: order.total_cents, status: 'succeeded', recorded_by: userId,
      }).onConflict(['provider', 'provider_ref']).ignore();
    }
    if (status === 'refunded') {
      update.payment_status = order.payment_status === 'paid' ? 'refunded' : order.payment_status;
      if (order.payment_status === 'paid') {
        await trx('payments').insert({
          order_id: order.id, provider: order.payment_method, provider_ref: `refund-${order.id}`,
          amount_cents: order.total_cents, status: 'refunded', recorded_by: userId, note: 'Marked refunded in admin',
        }).onConflict(['provider', 'provider_ref']).ignore();
      }
    }
    if (status === 'cancelled') await restock(trx, order, userId);
    await trx('orders').where({ id: order.id }).update(update);
    await trx('order_status_history').insert({ order_id: order.id, status, note: note || null, user_id: userId, customer_notified: notify });
    return true;
  });
  const order = await Order.findById(orderId);
  if (changed && notify) Mail.sendStatusUpdate(order, note).catch((err) => logger.error('status email failed', err));
  return order;
}

/** Create the hosted Stripe Checkout session for an order and remember its id. */
async function createStripeSession(order) {
  const stripe = getStripe();
  if (!stripe) throw new CheckoutError('Card payments are not available right now. Please choose another payment method.');
  const lineItems = order.items.map((i) => ({
    quantity: 1,
    price_data: {
      currency: 'cad',
      unit_amount: i.line_subtotal_cents - i.discount_cents,
      product_data: { name: `${i.qty} x ${i.name}${i.variant_name ? ` (${i.variant_name})` : ''}`.slice(0, 250) },
    },
  })).filter((li) => li.price_data.unit_amount > 0);
  if (order.shipping_cents > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: 'cad', unit_amount: order.shipping_cents, product_data: { name: order.shipping_label || 'Delivery' } } });
  }
  if (order.tax_cents > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: 'cad', unit_amount: order.tax_cents, product_data: { name: `${order.tax_label} (${order.tax_rate_bps / 100}%)` } } });
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: order.email,
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id), order_number: order.order_number },
    payment_intent_data: { description: `Order ${order.order_number}`, metadata: { order_id: String(order.id), order_number: order.order_number } },
    line_items: lineItems,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    success_url: `${env.appUrl}/order/${order.order_number}?t=${order.access_token}&paid=1`,
    cancel_url: `${env.appUrl}/order/${order.order_number}?t=${order.access_token}&cancelled=1`,
  });
  await db('orders').where({ id: order.id }).update({ stripe_session_id: session.id });
  return session;
}

/**
 * Record a confirmed online payment (Stripe webhook or PayPal capture) and mark the order paid.
 * Idempotent: the same payment may be reported more than once.
 */
async function markPaidOnline(orderId, { provider, ref, amountCents, currency }) {
  const result = await db.transaction(async (trx) => {
    const order = await trx('orders').where({ id: orderId }).forUpdate().first();
    if (!order || order.payment_status === 'paid') return { order, changed: false };
    if (amountCents !== order.total_cents || String(currency).toLowerCase() !== 'cad') {
      logger.error(`${provider} amount mismatch for ${order.order_number}: got ${amountCents} ${currency}, expected ${order.total_cents} cad`);
      // Money was taken but for the wrong amount. Park the order where staff will see it and where the
      // automatic clean-up will not cancel it; a person decides whether to accept or refund.
      const note = `${provider} payment ${ref} of ${(amountCents / 100).toFixed(2)} ${String(currency).toUpperCase()} does not match the order total - check the ${provider === 'paypal' ? 'PayPal' : 'Stripe'} account, then mark Paid or refund and cancel`;
      if (order.status === 'pending') await trx('orders').where({ id: order.id }).update({ status: 'awaiting_payment' });
      await trx('order_status_history').insert({ order_id: order.id, status: order.status === 'pending' ? 'awaiting_payment' : order.status, note });
      return { order, changed: false, mismatch: true };
    }
    await trx('payments').insert({
      order_id: order.id, provider, provider_ref: ref, amount_cents: amountCents, status: 'succeeded',
    }).onConflict(['provider', 'provider_ref']).ignore();
    if (order.status === 'cancelled') {
      // Paid after the order was auto-cancelled and restocked: flag for staff rather than guess.
      await trx('orders').where({ id: order.id }).update({ payment_status: 'paid', paid_at: new Date() });
      await trx('order_status_history').insert({
        order_id: order.id, status: 'cancelled', note: 'Payment received AFTER cancellation - refund or re-open manually',
      });
      return { order, changed: false, late: true };
    }
    await trx('orders').where({ id: order.id }).update({ status: 'paid', payment_status: 'paid', paid_at: new Date() });
    await trx('order_status_history').insert({
      order_id: order.id, status: 'paid', note: `Payment confirmed by ${provider === 'paypal' ? 'PayPal' : 'Stripe'}`, customer_notified: true,
    });
    return { order, changed: true };
  });
  if (result.changed) notifyPlaced(await Order.findById(orderId));
  return result;
}

/** Mark an order paid from a verified Stripe `checkout.session.completed` event. */
async function markPaidFromStripe(session) {
  const orderId = Number(session.client_reference_id || (session.metadata && session.metadata.order_id));
  if (!orderId) return null;
  if (session.payment_status !== 'paid') return null; // delayed payment methods confirm via async_payment_succeeded
  return markPaidOnline(orderId, {
    provider: 'stripe', ref: String(session.payment_intent || session.id), amountCents: session.amount_total, currency: session.currency,
  });
}

/** Create the PayPal order for a store order and remember its id. Returns the approval URL. */
async function createPaypalOrder(order, storeName) {
  if (!Paypal.isConfigured()) throw new CheckoutError('PayPal is not available right now. Please choose another payment method.');
  const qs = `o=${order.order_number}&t=${order.access_token}`;
  const pp = await Paypal.createOrder(order, {
    brandName: storeName, returnUrl: `${env.appUrl}/checkout/paypal/return?${qs}`, cancelUrl: `${env.appUrl}/order/${order.order_number}?t=${order.access_token}&cancelled=1`,
  });
  await db('orders').where({ id: order.id }).update({ paypal_order_id: pp.id });
  return pp.approveUrl;
}

/**
 * Capture an approved PayPal order and mark the store order paid. Everything is checked against
 * PayPal's own response: capture status, the order it belongs to, amount and currency.
 * @returns {Promise<'paid'|'pending'|'failed'>}
 */
async function capturePaypal(order) {
  if (!order.paypal_order_id) return 'failed';
  if (order.payment_status === 'paid') return 'paid';
  const pp = await Paypal.capture(order.paypal_order_id);
  if (pp.orderId !== order.id || !pp.capture) return 'failed';
  if (pp.capture.status === 'PENDING') return 'pending'; // e.g. eCheque: confirmed later by the hourly check
  if (pp.capture.status !== 'COMPLETED') return 'failed';
  const result = await markPaidOnline(order.id, { provider: 'paypal', ref: pp.capture.id, amountCents: pp.capture.amountCents, currency: pp.capture.currency });
  return result.mismatch ? 'failed' : 'paid';
}

/** Cancel an unpaid card/PayPal order (payment abandoned or expired) and return its stock. */
async function cancelUnpaidOnlineOrder(orderId, note) {
  const order = await db('orders').where({ id: orderId }).first();
  if (!order || !Order.ONLINE_METHODS.includes(order.payment_method) || order.status !== 'pending' || order.payment_status !== 'unpaid') return false;
  await changeStatus(orderId, 'cancelled', { note, notify: false, system: true });
  return true;
}

module.exports = { CheckoutError, placeOrder, changeStatus, createStripeSession, markPaidOnline, markPaidFromStripe, createPaypalOrder, capturePaypal, cancelUnpaidOnlineOrder, cancelUnpaidStripeOrder: cancelUnpaidOnlineOrder, restock };
