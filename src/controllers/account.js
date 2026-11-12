'use strict';
const db = require('../config/db');
const Order = require('../models/order');
const Product = require('../models/product');
const User = require('../models/user');
const Cart = require('../services/cart');
const { formatPostal } = require('../services/shipping');
const { z, trimmed, optionalText, phone, password, postalCode, province, checkbox } = require('../middleware/validation');

const PER_PAGE = 10;

const addressSchema = z.object({
  label: optionalText(60),
  full_name: trimmed(160, 'Full name'),
  phone: optionalText(30),
  line1: trimmed(190, 'Street address'),
  line2: optionalText(190),
  city: trimmed(100, 'City'),
  province,
  postal_code: postalCode,
  is_default: checkbox.optional(),
});
const profileSchema = z.object({ first_name: trimmed(80, 'First name'), last_name: trimmed(80, 'Last name'), phone: phone.or(z.literal('')).transform((v) => v || null) });
const passwordSchema = z.object({ current_password: z.string().min(1, 'Enter your current password'), password, password_confirm: z.string() })
  .refine((d) => d.password === d.password_confirm, { path: ['password_confirm'], message: 'Passwords do not match' });

/** GET /account */
async function dashboard(req, res) {
  const [orders, counts, wishlistCount, addressCount] = await Promise.all([
    db('orders').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(5),
    db('orders').where({ user_id: req.user.id }).count({ n: 'id' }).first(),
    db('wishlists').where({ user_id: req.user.id }).count({ n: 'id' }).first(),
    db('addresses').where({ user_id: req.user.id }).count({ n: 'id' }).first(),
  ]);
  res.render('account/dashboard', {
    title: 'My Account', noindex: true, section: 'dashboard', orders,
    stats: { orders: Number(counts.n), wishlist: Number(wishlistCount.n), addresses: Number(addressCount.n) },
  });
}

/** GET /account/orders */
async function orders(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const [{ n }] = await db('orders').where({ user_id: req.user.id }).count({ n: 'id' });
  const rows = await db('orders').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
  res.render('account/orders', {
    title: 'My Orders', noindex: true, section: 'orders', orders: rows, page, pages: Math.max(1, Math.ceil(Number(n) / PER_PAGE)),
  });
}

async function ownOrder(req) {
  if (!/^BAM-\d{6,12}$/.test(req.params.number)) return null;
  const order = await Order.findByNumber(req.params.number);
  return order && order.user_id === req.user.id ? order : null;
}

/** GET /account/orders/:number */
async function orderDetail(req, res, next) {
  const order = await ownOrder(req);
  if (!order) return next();
  return res.render('account/order', {
    title: `Order ${order.order_number}`, noindex: true, section: 'orders', order, steps: Order.trackerSteps(order),
  });
}

/** POST /account/orders/:number/reorder - put everything still available back in the cart */
async function reorder(req, res, next) {
  const order = await ownOrder(req);
  if (!order) return next();
  let added = 0;
  const skipped = [];
  for (const item of order.items) {
    const result = item.product_id ? await Cart.add(req, item.product_id, item.variant_id, item.qty) : { ok: false };
    if (result.ok) added += 1;
    else skipped.push(item.name);
  }
  if (added) req.flash('success', `${added} item${added === 1 ? '' : 's'} from order ${order.order_number} added to your cart at today's prices.`);
  if (skipped.length) req.flash('error', `Not available right now: ${skipped.join(', ')}.`);
  return res.redirect('/cart');
}

/** GET /account/addresses */
async function addresses(req, res) {
  const rows = await db('addresses').where({ user_id: req.user.id }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'id', order: 'desc' }]);
  res.render('account/addresses', { title: 'Address Book', noindex: true, section: 'addresses', addresses: rows });
}

async function addressForm(req, res, next) {
  let address = null;
  if (req.params.id) {
    address = await db('addresses').where({ id: Number(req.params.id) || 0, user_id: req.user.id }).first();
    if (!address) return next();
  }
  return res.render('account/address-form', { title: address ? 'Edit Address' : 'Add Address', noindex: true, section: 'addresses', address });
}

/** POST /account/addresses and /account/addresses/:id */
async function saveAddress(req, res, next) {
  const data = { ...req.valid, postal_code: formatPostal(req.valid.postal_code), is_default: Boolean(req.valid.is_default) };
  const outcome = await db.transaction(async (trx) => {
    const count = await trx('addresses').where({ user_id: req.user.id }).count({ n: 'id' }).first();
    if (Number(count.n) === 0) data.is_default = true;
    if (req.params.id) {
      const existing = await trx('addresses').where({ id: Number(req.params.id) || 0, user_id: req.user.id }).first('id');
      if (!existing) return 'missing';
      if (data.is_default) await trx('addresses').where({ user_id: req.user.id }).update({ is_default: false });
      await trx('addresses').where({ id: existing.id }).update(data);
      return 'saved';
    }
    if (Number(count.n) >= 20) return 'full';
    if (data.is_default) await trx('addresses').where({ user_id: req.user.id }).update({ is_default: false });
    await trx('addresses').insert({ ...data, user_id: req.user.id });
    return 'saved';
  });
  if (outcome === 'missing') return next();
  req.flash(outcome === 'saved' ? 'success' : 'error', outcome === 'saved' ? 'Address saved.' : 'You can save up to 20 addresses.');
  return res.redirect('/account/addresses');
}

/** POST /account/addresses/:id/delete */
async function deleteAddress(req, res) {
  await db('addresses').where({ id: Number(req.params.id) || 0, user_id: req.user.id }).del();
  req.flash('success', 'Address removed.');
  res.redirect('/account/addresses');
}

/** GET /account/wishlist */
async function wishlist(req, res) {
  const rows = await db('wishlists as w').join('products as p', 'p.id', 'w.product_id').leftJoin('brands as b', 'b.id', 'p.brand_id')
    .where({ 'w.user_id': req.user.id, 'p.is_active': true }).select(Product.LIST_COLUMNS).orderBy('w.id', 'desc').limit(200);
  await Product.attachImages(rows);
  res.render('account/wishlist', { title: 'My Wishlist', noindex: true, section: 'wishlist', products: rows });
}

/** GET /account/profile */
function profile(req, res) {
  res.render('account/profile', { title: 'Profile & Password', noindex: true, section: 'profile' });
}

/** POST /account/profile */
async function saveProfile(req, res) {
  await db('users').where({ id: req.user.id }).update(req.valid);
  req.flash('success', 'Your profile has been updated.');
  res.redirect('/account/profile');
}

/** POST /account/password */
async function changePassword(req, res) {
  const user = await User.findById(req.user.id);
  if (!(await User.verifyPassword(req.valid.current_password, user.password_hash))) {
    req.session.form = { old: {}, errors: { current_password: 'That is not your current password' } };
    req.flash('error', 'Your current password is incorrect.');
    return res.redirect('/account/profile');
  }
  await User.setPassword(user.id, req.valid.password);
  req.flash('success', 'Your password has been changed.');
  return res.redirect('/account/profile');
}

module.exports = {
  addressSchema, profileSchema, passwordSchema, dashboard, orders, orderDetail, reorder, addresses, addressForm,
  saveAddress, deleteAddress, wishlist, profile, saveProfile, changePassword,
};
