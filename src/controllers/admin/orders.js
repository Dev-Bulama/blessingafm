'use strict';
const db = require('../../config/db');
const Order = require('../../models/order');
const Audit = require('../../models/audit');
const OrderService = require('../../services/order');
const dates = require('../../lib/dates');
const { z, checkbox } = require('../../middleware/validation');

const PER_PAGE = 30;

/** GET /admin/orders */
async function list(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const f = {
    q: String(req.query.q || '').trim().slice(0, 80),
    status: Order.STATUSES.includes(req.query.status) ? req.query.status : '',
    fulfilment: ['pickup', 'delivery', 'shipping'].includes(req.query.fulfilment) ? req.query.fulfilment : '',
    payment: ['unpaid', 'paid', 'refunded'].includes(req.query.payment) ? req.query.payment : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : '',
  };
  const base = () => db('orders').modify((qb) => {
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
  const [{ n }] = await base().count({ n: 'id' });
  const orders = await base().orderBy('id', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
  res.render('admin/orders', { title: 'Orders', orders, f, page, pages: Math.max(1, Math.ceil(Number(n) / PER_PAGE)), total: Number(n), statuses: Order.STATUSES });
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

module.exports = { list, detail, statusSchema, changeStatus, detailsSchema, saveDetails, print };
