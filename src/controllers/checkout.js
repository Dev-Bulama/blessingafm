'use strict';
const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../config/logger');
const Order = require('../models/order');
const Cart = require('../services/cart');
const Checkout = require('../services/checkout');
const OrderService = require('../services/order');
const { OutOfStockError } = require('../services/inventory');
const { isValidPostal, normalizePostal } = require('../services/shipping');
const { z, email, phone, trimmed, optionalText, checkbox } = require('../middleware/validation');

const checkoutSchema = z.object({
  email,
  phone,
  first_name: trimmed(80, 'First name'),
  last_name: trimmed(80, 'Last name'),
  fulfilment: z.enum(['pickup', 'delivery', 'shipping'], { message: 'Choose how you want to receive your order' }),
  payment_method: z.enum(['stripe', 'paypal', 'etransfer', 'in_store'], { message: 'Choose a payment method' }),
  pickup_slot: z.string().trim().max(40).optional(), // "YYYY-MM-DD|slotId"
  ship_name: optionalText(160),
  line1: optionalText(190),
  line2: optionalText(190),
  city: optionalText(100),
  province: optionalText(2),
  postal_code: optionalText(10),
  note: optionalText(500),
  save_address: checkbox.optional(),
  agree: checkbox.refine((v) => v === true, 'Please accept the terms to place your order'),
}).superRefine((d, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (d.fulfilment === 'pickup') {
    if (!/^\d{4}-\d{2}-\d{2}\|\d+$/.test(d.pickup_slot || '')) issue('pickup_slot', 'Choose a pickup day and time');
    return;
  }
  if (!d.line1) issue('line1', 'Street address is required');
  if (!d.city) issue('city', 'City is required');
  if (!d.postal_code || !isValidPostal(d.postal_code)) issue('postal_code', 'Enter a valid Canadian postal code');
  const provinces = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
  if (!provinces.includes(d.province || '')) issue('province', 'Choose a province');
  else if (d.fulfilment === 'delivery' && d.province !== 'ON') issue('province', 'Local delivery is only available in Ontario');
});

const quoteSchema = z.object({
  fulfilment: z.enum(['pickup', 'delivery', 'shipping']),
  postal_code: z.string().trim().max(10).optional(),
});

function presentQuote(res, q) {
  const { money } = res.locals;
  const t = q.totals;
  return {
    ok: q.ok,
    errors: q.errors,
    blockers: q.blockers,
    shipping_label: q.shipping_label,
    free_delivery: q.free_delivery,
    tax_label: q.tax_label,
    coupon_code: q.coupon ? q.coupon.code : null,
    coupon_error: q.coupon_error,
    subtotal: money(t.subtotal_cents),
    discount: t.discount_cents ? `-${money(t.discount_cents)}` : null,
    shipping: t.shipping_cents ? money(t.shipping_cents) : 'Free',
    tax: money(t.tax_cents),
    total: money(t.total_cents),
  };
}

/** GET /checkout */
async function show(req, res) {
  const cart = await Cart.load(req);
  if (!cart.items.length) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/cart');
  }
  if (cart.hasProblems) {
    req.flash('error', 'Some items in your cart need attention before you can check out.');
    return res.redirect('/cart');
  }
  if (res.locals.settings.orders_paused === '1') return res.redirect('/cart');
  const { settings, old } = res.locals;
  const options = Checkout.options(settings);
  const [pickupDays, addresses] = await Promise.all([
    options.fulfilment.pickup ? Checkout.pickupOptions(settings) : [],
    req.user ? db('addresses').where({ user_id: req.user.id }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'id', order: 'desc' }]) : [],
  ]);
  const defaultAddress = addresses[0] || null;
  const available = ['pickup', 'delivery', 'shipping'].filter((m) => options.fulfilment[m]);
  const fulfilment = available.includes(old.fulfilment) ? old.fulfilment : available[0] || null;
  const postal = old.postal_code || (defaultAddress ? defaultAddress.postal_code : '');
  const quote = await Checkout.quote({ items: cart.items, couponCode: cart.coupon_code, fulfilment, postalCode: postal, settings });

  return res.render('store/checkout', {
    title: 'Checkout', noindex: true, pageScript: 'checkout', cart, quote, options, pickupDays, addresses, defaultAddress, fulfilment,
    shippingBlockers: require('../services/shipping').shippingBlockers(cart.items),
    deliveryBlockers: require('../services/shipping').deliveryBlockers(cart.items),
  });
}

/** POST /checkout/quote - live totals when the customer changes fulfilment or postal code */
async function quote(req, res) {
  const cart = await Cart.load(req);
  if (!cart.items.length) return res.status(409).json({ ok: false, message: 'Your cart is empty.' });
  const q = await Checkout.quote({
    items: cart.items, couponCode: cart.coupon_code, fulfilment: req.valid.fulfilment,
    postalCode: req.valid.postal_code || '', settings: res.locals.settings,
  });
  return res.json(presentQuote(res, q));
}

/** POST /checkout - place the order */
async function place(req, res) {
  const d = req.valid;
  const [pickupDate, pickupSlotId] = d.fulfilment === 'pickup' ? d.pickup_slot.split('|') : [null, null];
  const input = {
    email: d.email,
    phone: d.phone,
    first_name: d.first_name,
    last_name: d.last_name,
    fulfilment: d.fulfilment,
    payment_method: d.payment_method,
    pickup_date: pickupDate,
    pickup_slot_id: pickupSlotId ? Number(pickupSlotId) : null,
    address: {
      name: d.ship_name || `${d.first_name} ${d.last_name}`, line1: d.line1, line2: d.line2, city: d.city, province: d.province,
      postal_code: d.postal_code ? normalizePostal(d.postal_code) : null,
    },
    note: d.note,
  };

  let order;
  try {
    order = await OrderService.placeOrder({ req, input, settings: res.locals.settings });
  } catch (err) {
    if (err instanceof OrderService.CheckoutError || err instanceof OutOfStockError) {
      const { _csrf, ...old } = req.body;
      req.session.form = { old, errors: {} };
      req.flash('error', err.message);
      return res.redirect(err instanceof OutOfStockError ? '/cart' : '/checkout');
    }
    throw err;
  }

  if (req.user && d.save_address && d.fulfilment !== 'pickup') {
    const exists = await db('addresses').where({ user_id: req.user.id, line1: d.line1, postal_code: order.ship_postal_code }).first('id');
    if (!exists) {
      const hasAny = await db('addresses').where({ user_id: req.user.id }).first('id');
      await db('addresses').insert({
        user_id: req.user.id, full_name: input.address.name, phone: d.phone, line1: d.line1, line2: d.line2, city: d.city,
        province: d.province, postal_code: order.ship_postal_code, is_default: !hasAny,
      });
    }
  }

  const orderUrl = `/order/${order.order_number}?t=${order.access_token}`;
  if (order.payment_method === 'stripe') {
    try {
      const session = await OrderService.createStripeSession(order);
      return res.redirect(303, session.url);
    } catch (err) {
      logger.error(`Stripe session creation failed for ${order.order_number}`, err);
      await OrderService.cancelUnpaidOnlineOrder(order.id, 'Card payment could not be started');
      req.flash('error', 'We could not start the card payment, so your order was not placed and your items are back in stock. Please try again or choose another payment method.');
      return res.redirect('/cart');
    }
  }
  if (order.payment_method === 'paypal') {
    try {
      return res.redirect(303, await OrderService.createPaypalOrder(order, res.locals.settings.store_name));
    } catch (err) {
      logger.error(`PayPal order creation failed for ${order.order_number}`, err);
      await OrderService.cancelUnpaidOnlineOrder(order.id, 'PayPal payment could not be started');
      req.flash('error', 'We could not start the PayPal payment, so your order was not placed and your items are back in stock. Please try again or choose another payment method.');
      return res.redirect('/cart');
    }
  }
  return res.redirect(orderUrl);
}

/**
 * GET /checkout/paypal/return - the customer approved the payment at PayPal.
 * The payment is captured server-to-server; the order is marked paid only from PayPal's response.
 */
async function paypalReturn(req, res, next) {
  req.params.number = String(req.query.o || '');
  const order = await loadOrder(req);
  if (!order || order.payment_method !== 'paypal') return next();
  const back = `/order/${order.order_number}?t=${order.access_token}`;
  if (order.payment_status === 'paid') return res.redirect(`${back}&paid=1`);
  if (order.status !== 'pending' || !order.paypal_order_id || req.query.token !== order.paypal_order_id) {
    req.flash('error', 'This PayPal payment link is no longer valid. If you were charged, please contact us.');
    return res.redirect(back);
  }
  try {
    const outcome = await OrderService.capturePaypal(order);
    if (outcome === 'paid' || outcome === 'pending') return res.redirect(`${back}&paid=1`);
  } catch (err) {
    logger.error(`PayPal capture failed for ${order.order_number}`, err);
  }
  req.flash('error', 'PayPal could not complete the payment and you have not been charged. You can try again below.');
  return res.redirect(`${back}&cancelled=1`);
}

/** Guests reach an order with its secret token; customers and staff by being signed in. */
function canView(req, order) {
  if (!order) return false;
  if (req.user && (req.user.role !== 'customer' || req.user.id === order.user_id)) return true;
  const t = String(req.query.t || '');
  return t.length === order.access_token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(order.access_token));
}

async function loadOrder(req) {
  if (!/^BAM-\d{6,12}$/.test(req.params.number)) return null;
  const order = await Order.findByNumber(req.params.number);
  return canView(req, order) ? order : null;
}

/** GET /order/:number - confirmation and live status */
async function orderPage(req, res, next) {
  const order = await loadOrder(req);
  if (!order) return next();
  res.set('Cache-Control', 'no-store');
  return res.render('store/order', {
    title: `Order ${order.order_number}`, noindex: true, order, steps: Order.trackerSteps(order),
    token: req.query.t ? order.access_token : null,
    justPaid: req.query.paid === '1', paymentCancelled: req.query.cancelled === '1',
    payAvailable: Checkout.options(res.locals.settings).payment[order.payment_method] === true,
  });
}

/** GET /order/:number/invoice - printable invoice */
async function invoice(req, res, next) {
  const order = await loadOrder(req);
  if (!order) return next();
  res.set('Cache-Control', 'no-store');
  return res.render('store/invoice', { layout: 'layouts/print', title: `Invoice ${order.order_number}`, order, mode: 'invoice' });
}

/** POST /order/:number/pay - retry card payment for an order still awaiting it */
async function payAgain(req, res, next) {
  const order = await loadOrder(req);
  if (!order) return next();
  const back = `/order/${order.order_number}${req.query.t ? `?t=${order.access_token}` : ''}`;
  if (!Order.ONLINE_METHODS.includes(order.payment_method) || order.status !== 'pending' || order.payment_status !== 'unpaid') {
    req.flash('error', 'This order can no longer be paid online.');
    return res.redirect(back);
  }
  try {
    if (order.payment_method === 'paypal') return res.redirect(303, await OrderService.createPaypalOrder(order, res.locals.settings.store_name));
    const session = await OrderService.createStripeSession(order);
    return res.redirect(303, session.url);
  } catch (err) {
    logger.error(`Payment retry failed for ${order.order_number}`, err);
    req.flash('error', 'We could not start the payment. Please try again in a moment.');
    return res.redirect(back);
  }
}

const trackSchema = z.object({
  order_number: z.string({ error: 'Order number is required' }).trim().toUpperCase().regex(/^(BAM-)?\d{6,12}$/, 'Enter the order number from your confirmation email, e.g. BAM-100123'),
  email,
});

/** GET /track-order */
function trackForm(req, res) {
  res.render('store/track-order', { title: 'Track Your Order', metaDescription: 'Check the status of your order with your order number and email address.' });
}

/** POST /track-order - guests look up an order with its number and the email used at checkout */
async function track(req, res) {
  const number = req.valid.order_number.startsWith('BAM-') ? req.valid.order_number : `BAM-${req.valid.order_number}`;
  const order = await db('orders').where({ order_number: number, email: req.valid.email }).first('order_number', 'access_token');
  if (!order) {
    req.session.form = { old: { order_number: req.body.order_number, email: req.body.email }, errors: {} };
    req.flash('error', 'We could not find an order with that number and email address. Please check both and try again.');
    return res.redirect('/track-order');
  }
  return res.redirect(`/order/${order.order_number}?t=${order.access_token}`);
}

module.exports = { checkoutSchema, quoteSchema, show, quote, place, paypalReturn, orderPage, invoice, payAgain, trackSchema, trackForm, track };
