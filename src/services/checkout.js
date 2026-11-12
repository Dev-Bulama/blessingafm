'use strict';
const db = require('../config/db');
const Setting = require('../models/setting');
const pricing = require('./pricing');
const taxSvc = require('./tax');
const shippingSvc = require('./shipping');
const couponSvc = require('./coupon');
const dates = require('../lib/dates');
const { getStripe } = require('../config/stripe');
const Paypal = require('./paypal');

/** Which fulfilment and payment options the store currently offers. */
function options(settings) {
  const on = (k) => Setting.isOn(settings, k);
  return {
    fulfilment: {
      pickup: on('pickup_enabled'),
      delivery: on('delivery_enabled'),
      shipping: on('shipping_enabled'),
    },
    payment: {
      stripe: on('payment_stripe_enabled') && Boolean(getStripe()),
      paypal: on('payment_paypal_enabled') && Paypal.isConfigured(),
      etransfer: on('payment_etransfer_enabled') && Boolean(settings.etransfer_email),
      in_store: on('payment_instore_enabled'),
    },
  };
}

function paymentAllowed(method, fulfilment, opts) {
  if (!opts.payment[method]) return false;
  if (method === 'in_store') return fulfilment === 'pickup';
  return true;
}

/**
 * Price a cart for a chosen fulfilment method. Every number shown to the customer and stored on
 * the order comes from here.
 *
 * @returns {{ok:boolean, errors:string[], blockers:Array, totals:object, shipping_label:string|null,
 *   zone:object|null, coupon:object|null, coupon_error:string|null}}
 */
async function quote({ items, couponCode = null, fulfilment = null, postalCode = '', settings, trx = db }) {
  const errors = [];
  let blockers = [];
  const subtotal = items.reduce((n, i) => n + i.unit_price_cents * i.qty, 0);

  // Coupon
  let coupon = null;
  let couponError = null;
  let discount = 0;
  if (couponCode) {
    const row = await trx('coupons').where({ code: couponSvc.normalizeCode(couponCode) }).first();
    const result = couponSvc.evaluateCoupon(row, subtotal);
    if (result.valid) {
      coupon = row;
      discount = result.discount_cents;
    } else {
      couponError = result.reason;
    }
  }
  const amount = subtotal - discount;

  // Fulfilment fee
  let fee = 0;
  let shippingLabel = null;
  let zone = null;
  let freeDelivery = false;
  if (fulfilment === 'pickup') {
    shippingLabel = 'In-store pickup';
  } else if (fulfilment === 'delivery') {
    blockers = shippingSvc.deliveryBlockers(items);
    if (blockers.length) {
      errors.push('Some items in your cart are pickup only and cannot be delivered.');
    } else if (!shippingSvc.isValidPostal(postalCode)) {
      errors.push('Enter a valid Canadian postal code to check delivery to your area.');
    } else {
      const zones = await trx('delivery_zones').where({ is_active: true });
      zone = shippingSvc.matchZone(zones, postalCode);
      const dq = shippingSvc.deliveryQuote(zone, amount);
      if (!dq.ok) errors.push(dq.reason);
      else {
        fee = dq.fee_cents;
        freeDelivery = Boolean(dq.free);
        shippingLabel = `Local delivery - ${zone.name}`;
      }
    }
  } else if (fulfilment === 'shipping') {
    blockers = shippingSvc.shippingBlockers(items);
    if (blockers.length) {
      errors.push('Some items in your cart cannot be shipped. Remove them, or choose pickup or local delivery.');
    } else {
      const rates = await trx('shipping_rates').where({ is_active: true });
      const sq = shippingSvc.shippingQuote(rates, shippingSvc.cartWeight(items));
      if (!sq.ok) errors.push(sq.reason);
      else {
        fee = sq.rate_cents;
        shippingLabel = `Canada-wide shipping - ${sq.name}`;
      }
    }
  }

  const taxRateBps = taxSvc.rateToBps(settings.tax_rate);
  const totals = pricing.computeTotals({
    lines: items,
    discountCents: discount,
    shippingCents: fee,
    taxRateBps,
    taxShipping: Setting.isOn(settings, 'tax_shipping'),
  });

  return {
    ok: errors.length === 0,
    errors,
    blockers,
    totals,
    shipping_label: shippingLabel,
    free_delivery: freeDelivery,
    zone,
    coupon,
    coupon_error: couponError,
    tax_label: `${settings.tax_label || 'HST'} (${taxSvc.bpsToPercentLabel(taxRateBps)})`,
  };
}

/**
 * Pickup days and time slots the customer can choose, with remaining capacity.
 * @returns {Array<{date:string, label:string, slots:Array<{id:number, label:string, left:number}>}>}
 */
async function pickupOptions(settings, trx = db) {
  const daysAhead = Math.max(1, Math.min(30, Number(settings.pickup_days_ahead) || 7));
  const leadMinutes = Math.max(0, Number(settings.pickup_lead_minutes) || 0);
  const today = dates.storeDate();
  const lastDay = dates.addDays(today, daysAhead - 1);

  const [slots, booked] = await Promise.all([
    trx('pickup_slots').where({ is_active: true }).orderBy([{ column: 'day_of_week' }, { column: 'start_time' }]),
    trx('orders').whereBetween('pickup_date', [today, lastDay]).whereNotIn('status', ['cancelled', 'refunded'])
      .whereNotNull('pickup_slot_id').groupBy('pickup_date', 'pickup_slot_id')
      .select('pickup_slot_id', trx.raw("DATE_FORMAT(pickup_date, '%Y-%m-%d') as d")).count({ n: 'id' }),
  ]);
  const taken = new Map(booked.map((b) => [`${b.d}:${b.pickup_slot_id}`, Number(b.n)]));

  // Earliest slot end time we still accept today, as HH:MM:SS in store time.
  const cutoff = dates.storeTime(new Date(Date.now() + leadMinutes * 60000));
  const cutoffRollsOver = dates.storeDate(new Date(Date.now() + leadMinutes * 60000)) !== today;

  const closed = new Set(String(settings.pickup_closed_dates || '').split(/[\s,;]+/).filter(Boolean));
  const days = [];
  for (let i = 0; i < daysAhead; i += 1) {
    const date = dates.addDays(today, i);
    if (closed.has(date)) continue; // shop shut that day (holiday etc.)
    const dow = dates.dayOfWeek(date);
    const daySlots = slots
      .filter((s) => s.day_of_week === dow)
      .filter((s) => i > 0 || (!cutoffRollsOver && String(s.end_time) > cutoff))
      .map((s) => ({
        id: s.id,
        label: `${dates.formatTime(s.start_time)} - ${dates.formatTime(s.end_time)}`,
        left: s.capacity - (taken.get(`${date}:${s.id}`) || 0),
      }))
      .filter((s) => s.left > 0);
    if (daySlots.length) {
      days.push({ date, label: i === 0 ? `Today, ${dates.formatYmd(date)}` : dates.formatYmd(date), slots: daySlots });
    }
  }
  return days;
}

module.exports = { options, paymentAllowed, quote, pickupOptions };
