'use strict';
const db = require('../../config/db');
const Order = require('../../models/order');
const dates = require('../../lib/dates');

const CHART_DAYS = 14;

/** GET /admin */
async function index(req, res) {
  const today = dates.storeDate();
  const todayStart = dates.zonedToUtc(today);
  const weekStart = dates.zonedToUtc(dates.addDays(today, -((dates.dayOfWeek(today) + 6) % 7))); // Monday
  const monthStart = dates.zonedToUtc(`${today.slice(0, 7)}-01`);
  const chartStart = dates.zonedToUtc(dates.addDays(today, -(CHART_DAYS - 1)));
  const earliest = new Date(Math.min(monthStart.getTime(), chartStart.getTime(), weekStart.getTime()));

  const [paid, statusCounts, lowProducts, lowVariants, topProducts, recentOrders, unreadMessages, pendingReviews] = await Promise.all([
    // One bounded query feeds the three sales tiles and the chart; bucketing by store-local day is done in JS
    // so it does not depend on MySQL time zone tables being installed on the host.
    db('orders').where('payment_status', 'paid').where('paid_at', '>=', earliest).select('paid_at', 'total_cents').limit(20000),
    db('orders').groupBy('status').select('status').count({ n: 'id' }),
    db('products').where({ is_active: true, has_variants: false }).whereRaw('stock_qty <= low_stock_threshold')
      .select('id', 'name', 'sku', 'stock_qty').orderBy('stock_qty').limit(12),
    db('product_variants as v').join('products as p', 'p.id', 'v.product_id').where({ 'p.is_active': true, 'v.is_active': true })
      .whereRaw('v.stock_qty <= p.low_stock_threshold').select('p.id', 'p.name', 'v.name as variant_name', 'v.sku', 'v.stock_qty')
      .orderBy('v.stock_qty').limit(12),
    db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id').where('o.created_at', '>=', db.raw('NOW() - INTERVAL 30 DAY'))
      .whereNotIn('o.status', ['cancelled', 'refunded']).groupBy('oi.name')
      .select('oi.name').sum({ qty: 'oi.qty' }).sum({ revenue: 'oi.line_subtotal_cents' }).orderBy('qty', 'desc').limit(6),
    db('orders').orderBy('id', 'desc').limit(8),
    db('contact_messages').where({ is_read: false }).count({ n: 'id' }).first(),
    db('reviews').where({ status: 'pending' }).count({ n: 'id' }).first(),
  ]);

  const sum = (from) => paid.filter((o) => o.paid_at >= from).reduce((acc, o) => ({ total: acc.total + o.total_cents, count: acc.count + 1 }), { total: 0, count: 0 });
  const byDay = new Map();
  for (let i = 0; i < CHART_DAYS; i += 1) byDay.set(dates.addDays(today, i - (CHART_DAYS - 1)), 0);
  for (const o of paid) {
    const day = dates.storeDate(o.paid_at);
    if (byDay.has(day)) byDay.set(day, byDay.get(day) + o.total_cents);
  }
  const counts = Object.fromEntries(Order.STATUSES.map((s) => [s, 0]));
  for (const row of statusCounts) counts[row.status] = Number(row.n);
  const lowStock = [...lowProducts.map((p) => ({ ...p, variant_name: null })), ...lowVariants].sort((a, b) => a.stock_qty - b.stock_qty).slice(0, 12);

  res.render('admin/dashboard', {
    title: 'Dashboard',
    sales: { today: sum(todayStart), week: sum(weekStart), month: sum(monthStart) },
    chart: [...byDay.entries()].map(([day, cents]) => ({ day, label: dates.formatYmd(day).replace(/^\w+,\s*/, ''), cents })),
    counts, lowStock, topProducts, recentOrders,
    unreadMessages: Number(unreadMessages.n), pendingReviews: Number(pendingReviews.n),
  });
}

module.exports = { index };
