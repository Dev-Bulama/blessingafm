'use strict';
const db = require('../config/db');

const approvedForProduct = (productId, limit = 30) => db('reviews as r').join('users as u', 'u.id', 'r.user_id')
  .where({ 'r.product_id': productId, 'r.status': 'approved' })
  .select('r.id', 'r.rating', 'r.title', 'r.body', 'r.created_at', 'u.first_name', 'u.last_name')
  .orderBy('r.created_at', 'desc').limit(limit);

const findByUser = (productId, userId) => db('reviews').where({ product_id: productId, user_id: userId }).first();

/** Only customers with a paid/fulfilled order containing the product may review it. */
async function hasPurchased(userId, productId) {
  const row = await db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id')
    .where({ 'o.user_id': userId, 'oi.product_id': productId })
    .where(function paidOrDone() {
      this.where('o.payment_status', 'paid').orWhere('o.status', 'completed');
    })
    .whereNotIn('o.status', ['cancelled', 'refunded'])
    .first('oi.id');
  return Boolean(row);
}

module.exports = { approvedForProduct, findByUser, hasPurchased };
