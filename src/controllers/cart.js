'use strict';
const Cart = require('../services/cart');
const Checkout = require('../services/checkout');
const { normalizeCode } = require('../services/coupon');
const { z, id } = require('../middleware/validation');

const addSchema = z.object({
  product_id: id,
  variant_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), id.nullable()),
  qty: z.coerce.number().int().min(1).max(Cart.MAX_QTY).default(1),
});
const updateSchema = z.object({ item_id: id, qty: z.coerce.number().int().min(0).max(Cart.MAX_QTY) });
const removeSchema = z.object({ item_id: id });
const couponSchema = z.object({ code: z.string().trim().min(1, 'Enter a coupon code').max(40) });

/** Cart plus an estimate (no fulfilment fee yet) for the cart page and drawer. */
async function cartWithQuote(req, res) {
  const cart = await Cart.load(req);
  const quote = await Checkout.quote({ items: cart.items, couponCode: cart.coupon_code, settings: res.locals.settings });
  return { cart, quote };
}

function renderDrawer(res, data) {
  return new Promise((resolve, reject) => {
    res.render('partials/cart-drawer-body', { layout: false, ...data }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

/** After a cart change: JSON (with fresh drawer HTML) for fetch() calls, redirect for plain forms. */
async function respond(req, res, { ok = true, message = null, redirect = '/cart' } = {}) {
  if (req.xhr) {
    const data = await cartWithQuote(req, res);
    return res.status(ok ? 200 : 409).json({ ok, message, count: data.cart.count, html: await renderDrawer(res, data) });
  }
  if (message) req.flash(ok ? 'success' : 'error', message);
  return res.redirect(redirect);
}

/** GET /cart */
async function show(req, res) {
  const data = await cartWithQuote(req, res);
  res.render('store/cart', { title: 'Your Cart', noindex: true, ...data });
}

/** GET /cart/drawer - HTML fragment for the slide-out cart */
async function drawer(req, res) {
  const data = await cartWithQuote(req, res);
  res.set('Cache-Control', 'no-store');
  res.render('partials/cart-drawer-body', { layout: false, ...data });
}

/** POST /cart/add */
async function add(req, res) {
  const { product_id: productId, variant_id: variantId, qty } = req.valid;
  const result = await Cart.add(req, productId, variantId, qty);
  return respond(req, res, { ok: result.ok, message: result.message, redirect: result.ok ? '/cart' : (req.get('referer') ? new URL(req.get('referer'), 'http://x').pathname : '/cart') });
}

/** POST /cart/update */
async function update(req, res) {
  await Cart.setQty(req, req.valid.item_id, req.valid.qty);
  return respond(req, res);
}

/** POST /cart/remove */
async function remove(req, res) {
  await Cart.setQty(req, req.valid.item_id, 0);
  return respond(req, res, { message: 'Item removed from your cart.' });
}

/** POST /cart/coupon */
async function applyCoupon(req, res) {
  const code = normalizeCode(req.valid.code);
  const cart = await Cart.load(req);
  if (!cart.items.length) return respond(req, res, { ok: false, message: 'Add something to your cart before applying a coupon.' });
  const quote = await Checkout.quote({ items: cart.items, couponCode: code, settings: res.locals.settings });
  if (quote.coupon_error) return respond(req, res, { ok: false, message: quote.coupon_error });
  await Cart.setCoupon(req, code);
  return respond(req, res, { message: `Coupon ${code} applied.` });
}

/** POST /cart/coupon/remove */
async function removeCoupon(req, res) {
  await Cart.setCoupon(req, null);
  return respond(req, res, { message: 'Coupon removed.' });
}

module.exports = { addSchema, updateSchema, removeSchema, couponSchema, show, drawer, add, update, remove, applyCoupon, removeCoupon, cartWithQuote };
