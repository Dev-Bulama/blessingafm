'use strict';
const db = require('../../config/db');
const Order = require('../../models/order');
const Audit = require('../../models/audit');
const OrderService = require('../../services/order');
const dates = require('../../lib/dates');
const Csv = require('../../services/csv');
const { z, checkbox } = require('../../middleware/validation');

const PER_PAGE = 30;

function readFilters(query) {
  return {
    q: String(query.q || '').trim().slice(0, 80),
    status: Order.STATUSES.includes(query.status) ? query.status : '',
    fulfilment: ['pickup', 'delivery', 'shipping'].includes(query.fulfilment) ? query.fulfilment : '',
    payment: ['unpaid', 'paid', 'refunded'].includes(query.payment) ? query.payment : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : '',
  };
}

function filtered(f) {
  return db('orders').modify((qb) => {
    if (f.status) qb.where({ status: f.status });
    if (f.fulfilment) qb.where({ fulfilment_method: f.fulfilment });
    if (f.payment) qb.where({ payment_status: f.payment });
    if (f.from) qb.where('created_at', '>=', dates.zonedToUtc(f.from));
    if (f.to) qb.where('created_at', '<=', dates.zonedToUtc(f.to, '23:59:59'));
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
      qb.where((w) => w.where('order_number', 'like', like).orWhere('email', 'like', like).orWhere('phone', 'like', like)
        .orWhere('last_name', 'like', like).orWhere('first_name', 'like', like));
    }
  });
}

/** GET /admin/orders */
async function list(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const f = readFilters(req.query);
  const [{ n }] = await filtered(f).count({ n: 'id' });
  const orders = await filtered(f).orderBy('id', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
  res.render('admin/orders', { title: 'Orders', orders, f, page, pages: Math.max(1, Math.ceil(Number(n) / PER_PAGE)), total: Number(n), statuses: Order.STATUSES });
}

/** GET /admin/orders/export.csv - the filtered orders, one row per order, for bookkeeping */
async function exportCsv(req, res) {
  const rows = await filtered(readFilters(req.query)).orderBy('id', 'desc').limit(20000);
  const dollars = (c) => (c / 100).toFixed(2);
  const columns = ['order_number', 'placed_at', 'status', 'customer', 'email', 'phone', 'fulfilment', 'payment_method', 'payment_status', 'paid_at',
    'subtotal', 'discount', 'coupon', 'delivery_or_shipping', 'tax', 'total', 'city', 'province', 'postal_code', 'pickup_date', 'tracking_number'];
  const out = rows.map((o) => ({
    order_number: o.order_number, placed_at: dates.formatDateTime(o.created_at), status: Order.STATUS_LABELS[o.status],
    customer: `${o.first_name} ${o.last_name}`, email: o.email, phone: o.phone, fulfilment: Order.FULFILMENT_LABELS[o.fulfilment_method],
    payment_method: Order.PAYMENT_LABELS[o.payment_method], payment_status: o.payment_status, paid_at: o.paid_at ? dates.formatDateTime(o.paid_at) : '',
    subtotal: dollars(o.subtotal_cents), discount: dollars(o.discount_cents), coupon: o.coupon_code || '', delivery_or_shipping: dollars(o.shipping_cents),
    tax: dollars(o.tax_cents), total: dollars(o.total_cents), city: o.ship_city || '', province: o.ship_province || '', postal_code: o.ship_postal_code || '',
    pickup_date: o.pickup_date ? dates.formatYmd(o.pickup_date) : '', tracking_number: o.tracking_number || '',
  }));
  await Audit.log(req, 'export', 'orders', null, { rows: out.length });
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(`\uFEFF${Csv.toCsv(columns, out)}`);
}

/** GET /admin/orders/:id */
async function detail(req, res, next) {
  const order = await Order.findById(Number(req.params.id) || 0);
  if (!order) return next();
  const customer = order.user_id ? await db('users').where({ id: order.user_id }).first('id', 'first_name', 'last_name', 'email') : null;
  return res.render('admin/order', { title: `Order ${order.order_number}`, order, customer, next: Order.nextStatuses(order) });
}

const statusSchema = z.object({
  status: z.enum(Order.STATUSES),
  note: z.string().trim().max(500).optional(),
  notify: checkbox,
});

/** POST /admin/orders/:id/status - emails the customer unless "notify" is unticked */
async function changeStatus(req, res, next) {
  const id = Number(req.params.id) || 0;
  const before = await db('orders').where({ id }).first('id', 'status', 'order_number');
  if (!before) return next();
  try {
    const order = await OrderService.changeStatus(id, req.valid.status, { userId: req.user.id, note: req.valid.note || '', notify: req.valid.notify });
    await Audit.log(req, 'order_status', 'orders', id, { order_number: order.order_number, from: before.status, to: order.status, notified: req.valid.notify });
    req.flash('success', `Order ${order.order_number} is now "${Order.STATUS_LABELS[order.status]}"${req.valid.notify ? ' and the customer has been emailed' : ''}${order.status === 'cancelled' ? '. Stock has been returned.' : '.'}`);
  } catch (err) {
    if (!(err instanceof OrderService.CheckoutError)) throw err;
    req.flash('error', err.message);
  }
  return res.redirect(`/admin/orders/${id}`);
}

const detailsSchema = z.object({
  tracking_carrier: z.string().trim().max(60).optional(),
  tracking_number: z.string().trim().max(80).optional(),
  internal_notes: z.string().trim().max(5000).optional(),
});

/** POST /admin/orders/:id/details - tracking number and internal notes */
async function saveDetails(req, res, next) {
  const id = Number(req.params.id) || 0;
  const updated = await db('orders').where({ id }).update({
    tracking_carrier: req.valid.tracking_carrier || null,
    tracking_number: req.valid.tracking_number || null,
    internal_notes: req.valid.internal_notes || null,
  });
  if (!updated && !(await db('orders').where({ id }).first('id'))) return next();
  await Audit.log(req, 'order_details', 'orders', id, { tracking_number: req.valid.tracking_number || null });
  req.flash('success', 'Order details saved.');
  return res.redirect(`/admin/orders/${id}`);
}

/** GET /admin/orders/:id/invoice and /admin/orders/:id/packing-slip */
function print(mode) {
  return async function printOrder(req, res, next) {
    const order = await Order.findById(Number(req.params.id) || 0);
    if (!order) return next();
    return res.render('store/invoice', {
      layout: 'layouts/print', title: `${mode === 'packing' ? 'Packing slip' : 'Invoice'} ${order.order_number}`, order, mode,
    });
  };
}

module.exports = { exportCsv, list, detail, statusSchema, changeStatus, detailsSchema, saveDetails, print };
