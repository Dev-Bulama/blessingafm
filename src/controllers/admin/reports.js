'use strict';
const db = require('../../config/db');
const Order = require('../../models/order');
const dates = require('../../lib/dates');

/**
 * GET /admin/reports - sales and tax for a date range (by payment date, store time).
 * Refunded orders are excluded from the totals and counted separately.
 */
async function index(req, res) {
  const today = dates.storeDate();
  const valid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
  let from = valid(req.query.from) ? req.query.from : `${today.slice(0, 7)}-01`;
  let to = valid(req.query.to) ? req.query.to : today;
  if (to < from) [from, to] = [to, from];
  const start = dates.zonedToUtc(from);
  const end = dates.zonedToUtc(to, '23:59:59');
  const paid = () => db('orders as o').where('o.payment_status', 'paid').whereBetween('o.paid_at', [start, end]);

  const [totals, byPayment, byFulfilment, taxSplit, topProducts, refunded, cancelled] = await Promise.all([
    paid().first(
      db.raw('COUNT(*) as orders'), db.raw('COALESCE(SUM(subtotal_cents),0) as subtotal'), db.raw('COALESCE(SUM(discount_cents),0) as discount'),
      db.raw('COALESCE(SUM(shipping_cents),0) as shipping'), db.raw('COALESCE(SUM(tax_cents),0) as tax'), db.raw('COALESCE(SUM(total_cents),0) as total'),
    ),
    paid().groupBy('o.payment_method').select('o.payment_method as k').count({ orders: 'o.id' }).sum({ total: 'o.total_cents' }).orderBy('total', 'desc'),
    paid().groupBy('o.fulfilment_method').select('o.fulfilment_method as k').count({ orders: 'o.id' }).sum({ total: 'o.total_cents' }).sum({ fees: 'o.shipping_cents' }).orderBy('total', 'desc'),
    paid().join('order_items as oi', 'oi.order_id', 'o.id').groupBy('oi.is_taxable').select('oi.is_taxable')
      .select(db.raw('COALESCE(SUM(oi.line_subtotal_cents - oi.discount_cents),0) as net'), db.raw('COALESCE(SUM(oi.tax_cents),0) as tax')),
    paid().join('order_items as oi', 'oi.order_id', 'o.id').groupBy('oi.name', 'oi.sku').select('oi.name', 'oi.sku')
      .sum({ qty: 'oi.qty' }).select(db.raw('SUM(oi.line_subtotal_cents - oi.discount_cents) as net')).orderBy('net', 'desc').limit(20),
    db('orders').where({ payment_status: 'refunded' }).whereBetween('paid_at', [start, end]).first(db.raw('COUNT(*) as orders'), db.raw('COALESCE(SUM(total_cents),0) as total')),
    db('orders').where({ status: 'cancelled' }).whereBetween('created_at', [start, end]).count({ n: 'id' }).first(),
  ]);

  const num = (v) => Number(v || 0);
  const taxable = taxSplit.find((r) => r.is_taxable) || {};
  const zeroRated = taxSplit.find((r) => !r.is_taxable) || {};
  const t = { orders: num(totals.orders), subtotal: num(totals.subtotal), discount: num(totals.discount), shipping: num(totals.shipping), tax: num(totals.tax), total: num(totals.total) };
  res.render('admin/reports', {
    title: 'Sales & tax report', from, to, t,
    average: t.orders ? Math.round(t.total / t.orders) : 0,
    taxableNet: num(taxable.net), itemsTax: num(taxable.tax), zeroRatedNet: num(zeroRated.net), shippingTax: t.tax - num(taxable.tax),
    byPayment: byPayment.map((r) => ({ label: Order.PAYMENT_LABELS[r.k] || r.k, orders: num(r.orders), total: num(r.total) })),
    byFulfilment: byFulfilment.map((r) => ({ label: Order.FULFILMENT_LABELS[r.k] || r.k, orders: num(r.orders), total: num(r.total), fees: num(r.fees) })),
    topProducts: topProducts.map((r) => ({ ...r, qty: num(r.qty), net: num(r.net) })),
    refunded: { orders: num(refunded.orders), total: num(refunded.total) }, cancelled: num(cancelled.n),
    presets: [
      ['This month', `${today.slice(0, 7)}-01`, today],
      ['Last month', `${dates.addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`, dates.addDays(`${today.slice(0, 7)}-01`, -1)],
      ['Last 7 days', dates.addDays(today, -6), today],
      ['This year', `${today.slice(0, 4)}-01-01`, today],
    ],
  });
}

module.exports = { index };
