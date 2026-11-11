'use strict';
const db = require('../config/db');
const Product = require('../models/product');

const MAX_QTY = 99;

async function findCartId(req) {
  if (req.user) {
    const cart = await db('carts').where({ user_id: req.user.id }).first('id');
    return cart ? cart.id : null;
  }
  if (!req.session.cartId) return null;
  const cart = await db('carts').where({ id: req.session.cartId }).whereNull('user_id').first('id');
  if (!cart) {
    delete req.session.cartId;
    return null;
  }
  return cart.id;
}

async function ensureCartId(req) {
  const existing = await findCartId(req);
  if (existing) return existing;
  if (req.user) {
    await db('carts').insert({ user_id: req.user.id }).onConflict('user_id').ignore();
    return (await db('carts').where({ user_id: req.user.id }).first('id')).id;
  }
  const [id] = await db('carts').insert({});
  req.session.cartId = id;
  return id;
}

const touch = (cartId) => db('carts').where({ id: cartId }).update({ updated_at: new Date() });

async function loadItems(cartId, trx = db) {
  const rows = await trx('cart_items as ci')
    .join('products as p', 'p.id', 'ci.product_id')
    .leftJoin('product_variants as v', 'v.id', 'ci.variant_id')
    .where('ci.cart_id', cartId)
    .orderBy('ci.id')
    .select(
      'ci.id as item_id', 'ci.qty', 'ci.product_id', 'ci.variant_id',
      'p.name', 'p.slug', 'p.sku as product_sku', 'p.price_cents as product_price', 'p.compare_at_cents as product_compare',
      'p.stock_qty as product_stock', 'p.weight_grams as product_weight', 'p.has_variants', 'p.variant_label',
      'p.is_taxable', 'p.is_perishable', 'p.is_frozen', 'p.pickup_only', 'p.is_active as product_active',
      'v.name as variant_name', 'v.sku as variant_sku', 'v.price_cents as variant_price', 'v.compare_at_cents as variant_compare',
      'v.stock_qty as variant_stock', 'v.weight_grams as variant_weight', 'v.is_active as variant_active',
    );
  const items = rows.map((r) => {
    const hasVariant = r.variant_id !== null;
    const stock = Math.max(0, hasVariant ? r.variant_stock : r.product_stock);
    const purchasable = Boolean(r.product_active) && (hasVariant ? Boolean(r.variant_active) : !r.has_variants);
    const unit = hasVariant ? r.variant_price : r.product_price;
    return {
      id: r.product_id, // lets Product.attachImages work on cart lines
      item_id: r.item_id,
      product_id: r.product_id,
      variant_id: r.variant_id,
      name: r.name,
      variant_name: r.variant_name,
      variant_label: r.variant_label,
      slug: r.slug,
      sku: hasVariant ? r.variant_sku : r.product_sku,
      unit_price_cents: unit,
      compare_at_cents: hasVariant ? r.variant_compare : r.product_compare,
      qty: r.qty,
      line_cents: unit * r.qty,
      weight_grams: hasVariant ? r.variant_weight : r.product_weight,
      is_taxable: Boolean(r.is_taxable),
      is_perishable: Boolean(r.is_perishable),
      is_frozen: Boolean(r.is_frozen),
      pickup_only: Boolean(r.pickup_only),
      stock,
      purchasable,
      problem: !purchasable ? 'This item is no longer available.'
        : stock === 0 ? 'Out of stock.'
          : r.qty > stock ? `Only ${stock} available.` : null,
    };
  });
  return items;
}

/** The current visitor's cart with priced lines. Always returns an object, even when empty. */
async function load(req) {
  const cartId = await findCartId(req);
  if (!cartId) return { id: null, coupon_code: null, items: [], count: 0, subtotal_cents: 0, hasProblems: false };
  const cart = await db('carts').where({ id: cartId }).first();
  const items = await loadItems(cartId);
  await Product.attachImages(items);
  return {
    id: cartId,
    coupon_code: cart.coupon_code,
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    subtotal_cents: items.reduce((n, i) => n + i.line_cents, 0),
    hasProblems: items.some((i) => i.problem),
  };
}

/** Item count for the header badge (one small query, none for visitors without a cart). */
async function count(req) {
  if (!req.user && !req.session.cartId) return 0;
  const q = db('cart_items as ci').join('carts as c', 'c.id', 'ci.cart_id');
  if (req.user) q.where('c.user_id', req.user.id);
  else q.where('c.id', req.session.cartId).whereNull('c.user_id');
  const row = await q.sum({ n: 'ci.qty' }).first();
  return Number(row.n || 0);
}

/** Add a product (and variant) to the cart. Returns { ok, message }. */
async function add(req, productId, variantId, qty) {
  const product = await db('products').where({ id: productId, is_active: true }).first('id', 'name', 'stock_qty', 'has_variants');
  if (!product) return { ok: false, message: 'That product is no longer available.' };
  let stock = product.stock_qty;
  let vId = null;
  if (product.has_variants) {
    const variant = variantId
      ? await db('product_variants').where({ id: variantId, product_id: productId, is_active: true }).first('id', 'stock_qty')
      : null;
    if (!variant) return { ok: false, message: 'Please choose an option first.' };
    stock = variant.stock_qty;
    vId = variant.id;
  }
  if (stock <= 0) return { ok: false, message: `${product.name} is out of stock.` };

  const cartId = await ensureCartId(req);
  const existing = await db('cart_items').where({ cart_id: cartId, product_id: productId })
    .where((qb) => (vId ? qb.where('variant_id', vId) : qb.whereNull('variant_id'))).first();
  const wanted = Math.min(MAX_QTY, (existing ? existing.qty : 0) + Math.max(1, qty));
  const finalQty = Math.min(wanted, stock);
  if (existing) await db('cart_items').where({ id: existing.id }).update({ qty: finalQty });
  else await db('cart_items').insert({ cart_id: cartId, product_id: productId, variant_id: vId, qty: finalQty });
  await touch(cartId);
  return {
    ok: true,
    message: finalQty < wanted ? `Only ${stock} of ${product.name} available - your cart has been updated.` : `${product.name} added to your cart.`,
  };
}

async function setQty(req, itemId, qty) {
  const cartId = await findCartId(req);
  if (!cartId) return;
  if (qty <= 0) {
    await db('cart_items').where({ id: itemId, cart_id: cartId }).del();
  } else {
    const items = await loadItems(cartId);
    const item = items.find((i) => i.item_id === itemId);
    if (!item) return;
    const finalQty = Math.max(1, Math.min(qty, MAX_QTY, item.stock || 1));
    await db('cart_items').where({ id: itemId, cart_id: cartId }).update({ qty: finalQty });
  }
  await touch(cartId);
}

async function setCoupon(req, code) {
  const cartId = code ? await ensureCartId(req) : await findCartId(req);
  if (cartId) await db('carts').where({ id: cartId }).update({ coupon_code: code || null });
}

/** Move a guest's cart into the customer's saved cart after login or registration. */
async function mergeOnLogin(req, userId) {
  const guestCartId = req.session.cartId;
  delete req.session.cartId;
  if (!guestCartId) return;
  const guest = await db('carts').where({ id: guestCartId }).whereNull('user_id').first();
  if (!guest) return;
  await db.transaction(async (trx) => {
    let userCart = await trx('carts').where({ user_id: userId }).first();
    if (!userCart) {
      await trx('carts').where({ id: guestCartId }).update({ user_id: userId, updated_at: new Date() });
      return;
    }
    const [guestItems, userItems] = await Promise.all([
      trx('cart_items').where({ cart_id: guestCartId }),
      trx('cart_items').where({ cart_id: userCart.id }),
    ]);
    for (const g of guestItems) {
      const match = userItems.find((u) => u.product_id === g.product_id && u.variant_id === g.variant_id);
      if (match) {
        await trx('cart_items').where({ id: match.id }).update({ qty: Math.min(MAX_QTY, match.qty + g.qty) });
      } else {
        await trx('cart_items').insert({ cart_id: userCart.id, product_id: g.product_id, variant_id: g.variant_id, qty: g.qty });
      }
    }
    await trx('carts').where({ id: userCart.id }).update({
      coupon_code: guest.coupon_code || userCart.coupon_code, updated_at: new Date(),
    });
    await trx('carts').where({ id: guestCartId }).del();
  });
}

async function clear(cartId, trx = db) {
  await trx('cart_items').where({ cart_id: cartId }).del();
  await trx('carts').where({ id: cartId }).update({ coupon_code: null, updated_at: new Date() });
}

module.exports = { MAX_QTY, load, loadItems, count, add, setQty, setCoupon, mergeOnLogin, clear, ensureCartId, findCartId };
