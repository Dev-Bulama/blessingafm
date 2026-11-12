'use strict';
const db = require('../config/db');

const STATUSES = ['pending', 'awaiting_payment', 'paid', 'processing', 'ready_for_pickup', 'out_for_delivery', 'shipped',
  'completed', 'cancelled', 'refunded'];

const STATUS_LABELS = {
  pending: 'Pending',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  processing: 'Processing',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const FULFILMENT_LABELS = { pickup: 'In-store pickup', delivery: 'Local delivery', shipping: 'Canada-wide shipping' };
const ONLINE_METHODS = ['stripe', 'paypal'];
const PAYMENT_LABELS = { stripe: 'Card (Stripe)', paypal: 'PayPal', etransfer: 'Interac e-Transfer', in_store: 'Pay in store' };

/** Allowed next statuses, given the current status and fulfilment method. */
function nextStatuses(order) {
  const dispatch = { pickup: 'ready_for_pickup', delivery: 'out_for_delivery', shipping: 'shipped' }[order.fulfilment_method];
  const map = {
    pending: ['awaiting_payment', 'paid', 'processing', 'cancelled'],
    awaiting_payment: ['paid', 'cancelled'],
    paid: ['processing', dispatch, 'cancelled', 'refunded'],
    processing: [dispatch, 'completed', 'cancelled', 'refunded'],
    ready_for_pickup: ['completed', 'cancelled', 'refunded'],
    out_for_delivery: ['completed', 'cancelled', 'refunded'],
    shipped: ['completed', 'refunded'],
    completed: ['refunded'],
    cancelled: [],
    refunded: [],
  };
  return map[order.status] || [];
}

/** Steps shown on the customer's order tracker. */
function trackerSteps(order) {
  const dispatch = { pickup: 'ready_for_pickup', delivery: 'out_for_delivery', shipping: 'shipped' }[order.fulfilment_method];
  const first = order.payment_method === 'etransfer' ? 'awaiting_payment' : 'pending';
  const steps = order.payment_method === 'in_store'
    ? [first, 'processing', dispatch, 'completed']
    : [first, 'paid', 'processing', dispatch, 'completed'];
  const rank = { pending: 0, awaiting_payment: 0, paid: 1, processing: 2, ready_for_pickup: 3, out_for_delivery: 3, shipped: 3, completed: 4 };
  const current = rank[order.status] ?? -1;
  return steps.map((s) => ({ status: s, label: STATUS_LABELS[s], done: current >= rank[s], current: order.status === s }));
}

async function withDetails(order) {
  if (!order) return null;
  const [items, history, payments] = await Promise.all([
    db('order_items').where({ order_id: order.id }).orderBy('id'),
    db('order_status_history as h').leftJoin('users as u', 'u.id', 'h.user_id').where('h.order_id', order.id)
      .select('h.*', 'u.first_name as by_first_name', 'u.last_name as by_last_name').orderBy('h.id'),
    db('payments').where({ order_id: order.id }).orderBy('id'),
  ]);
  return { ...order, items, history, payments };
}

const findById = async (id) => withDetails(await db('orders').where({ id }).first());
const findByNumber = async (orderNumber) => withDetails(await db('orders').where({ order_number: orderNumber }).first());

module.exports = { ONLINE_METHODS, STATUSES, STATUS_LABELS, FULFILMENT_LABELS, PAYMENT_LABELS, nextStatuses, trackerSteps, findById, findByNumber };
