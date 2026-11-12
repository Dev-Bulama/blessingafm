'use strict';
const db = require('../config/db');
const Product = require('../models/product');

class OutOfStockError extends Error {
  constructor(message, item) {
    super(message);
    this.name = 'OutOfStockError';
    this.item = item;
    this.status = 409;
    this.expose = true;
  }
}

/**
 * Change stock by `delta` (negative to take stock, positive to return it) and log the movement.
 * Decrements are a single guarded UPDATE (`WHERE stock_qty >= n`), so two concurrent orders can
 * never both take the last unit. Must be called inside a transaction.
 */
async function adjust(trx, { productId, variantId = null, delta, reason, note = null, orderId = null, userId = null, label = 'This item' }) {
  if (!Number.isInteger(delta) || delta === 0) return null;
  const table = variantId ? 'product_variants' : 'products';
  const where = variantId ? { id: variantId, product_id: productId } : { id: productId };

  let affected;
  if (delta < 0) {
    affected = await trx(table).where(where).where('stock_qty', '>=', -delta).decrement('stock_qty', -delta);
  } else {
    affected = await trx(table).where(where).increment('stock_qty', delta);
  }
  if (!affected) {
    // Locking read: returns the latest committed quantity, not this transaction's older snapshot.
    const row = await trx(table).where(where).forUpdate().first('stock_qty');
    const left = row ? Math.max(0, row.stock_qty) : 0;
    throw new OutOfStockError(
      left > 0 ? `Only ${left} left of ${label}. Please update your cart.` : `${label} is now out of stock. Please remove it from your cart.`,
      { productId, variantId, left },
    );
  }

  const row = await trx(table).where(where).first('stock_qty');
  if (variantId) await Product.syncVariantAggregates(productId, trx);
  await trx('inventory_logs').insert({
    product_id: productId, variant_id: variantId, change_qty: delta, qty_after: row.stock_qty, reason, note, order_id: orderId, user_id: userId,
  });
  return row.stock_qty;
}

/** Set stock to an absolute quantity (admin adjustments, CSV import). Opens its own transaction if none given. */
async function setStock({ productId, variantId = null, newQty, reason = 'adjustment', note = null, userId = null }, trx = null) {
  const run = async (t) => {
    const table = variantId ? 'product_variants' : 'products';
    const where = variantId ? { id: variantId, product_id: productId } : { id: productId };
    const row = await t(table).where(where).forUpdate().first('stock_qty');
    if (!row) return null;
    const delta = newQty - row.stock_qty;
    if (delta === 0) return row.stock_qty;
    return adjust(t, { productId, variantId, delta, reason, note, userId });
  };
  return trx ? run(trx) : db.transaction(run);
}

/** True when a stock decrease takes an item from above its low-stock threshold to at or below it. */
function crossedLowStock(before, after, threshold) {
  return after < before && before > threshold && after <= threshold;
}

module.exports = { OutOfStockError, adjust, setStock, crossedLowStock };
