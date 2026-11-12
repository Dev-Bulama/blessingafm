'use strict';
const db = require('../../config/db');
const User = require('../../models/user');
const Audit = require('../../models/audit');
const { z, trimmed, email, password } = require('../../middleware/validation');

const PER_PAGE = 40;

/** GET /admin/customers */
async function list(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const base = () => db('users as u').where('u.role', 'customer').modify((qb) => {
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      qb.where((w) => w.where('u.email', 'like', like).orWhere('u.first_name', 'like', like).orWhere('u.last_name', 'like', like).orWhere('u.phone', 'like', like));
    }
  });
  const [{ n }] = await base().count({ n: 'u.id' });
  // Order totals come from one grouped join, not a query per customer.
  const customers = await base()
    .leftJoin(db('orders').whereNotIn('status', ['cancelled', 'refunded']).groupBy('user_id')
      .select('user_id').count({ order_count: 'id' }).sum({ spent_cents: 'total_cents' }).as('o'), 'o.user_id', 'u.id')
    .select('u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.phone', 'u.is_disabled', 'u.email_verified_at', 'u.created_at', 'o.order_count', 'o.spent_cents')
    .orderBy('u.id', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
  res.render('admin/customers', { title: 'Customers', customers, q, page, pages: Math.max(1, Math.ceil(Number(n) / PER_PAGE)), total: Number(n) });
}

/** GET /admin/customers/:id */
async function detail(req, res, next) {
  const customer = await db('users').where({ id: Number(req.params.id) || 0, role: 'customer' }).first();
  if (!customer) return next();
  const [orders, addresses] = await Promise.all([
    db('orders').where({ user_id: customer.id }).orderBy('id', 'desc').limit(100),
    db('addresses').where({ user_id: customer.id }).orderBy('is_default', 'desc'),
  ]);
  return res.render('admin/customer', { title: `${customer.first_name} ${customer.last_name}`, customer, orders, addresses });
}

/** POST /admin/customers/:id/toggle - disable or re-enable an account */
async function toggle(req, res, next) {
  const customer = await db('users').where({ id: Number(req.params.id) || 0, role: 'customer' }).first();
  if (!customer) return next();
  await db('users').where({ id: customer.id }).update({ is_disabled: !customer.is_disabled });
  await Audit.log(req, customer.is_disabled ? 'customer_enable' : 'customer_disable', 'users', customer.id, { email: customer.email });
  req.flash('success', customer.is_disabled ? 'Account re-enabled.' : 'Account disabled. The customer can no longer sign in.');
  return res.redirect(`/admin/customers/${customer.id}`);
}

// ---------- Staff accounts (admin only) ----------

/** GET /admin/staff */
async function staff(req, res) {
  const users = await db('users').whereIn('role', ['admin', 'staff']).orderBy('id');
  res.render('admin/staff', { title: 'Staff accounts', users });
}

const staffSchema = z.object({
  first_name: trimmed(80, 'First name'),
  last_name: trimmed(80, 'Last name'),
  email,
  password,
  role: z.enum(['admin', 'staff']),
});

/** POST /admin/staff */
async function createStaff(req, res) {
  if (await User.findByEmail(req.valid.email)) {
    req.flash('error', 'A user with that email already exists. To promote a customer, use "Change role" below after they are listed, or use a different email.');
    return res.redirect('/admin/staff');
  }
  const user = await User.create({ ...req.valid, verified: true });
  await Audit.log(req, 'staff_create', 'users', user.id, { email: user.email, role: user.role });
  req.flash('success', `${user.role === 'admin' ? 'Admin' : 'Staff'} account created for ${user.email}.`);
  return res.redirect('/admin/staff');
}

const staffUpdateSchema = z.object({ action: z.enum(['make_admin', 'make_staff', 'disable', 'enable', 'remove']) });

/** POST /admin/staff/:id */
async function updateStaff(req, res, next) {
  const user = await db('users').where({ id: Number(req.params.id) || 0 }).whereIn('role', ['admin', 'staff']).first();
  if (!user) return next();
  if (user.id === req.user.id) {
    req.flash('error', 'You cannot change your own role or disable your own account.');
    return res.redirect('/admin/staff');
  }
  const changes = {
    make_admin: { role: 'admin' }, make_staff: { role: 'staff' }, disable: { is_disabled: true }, enable: { is_disabled: false },
    remove: { role: 'customer' }, // keeps the login and order history, removes admin panel access
  }[req.valid.action];
  await db('users').where({ id: user.id }).update(changes);
  await Audit.log(req, `staff_${req.valid.action}`, 'users', user.id, { email: user.email });
  req.flash('success', 'Staff account updated.');
  return res.redirect('/admin/staff');
}

module.exports = { list, detail, toggle, staff, staffSchema, createStaff, staffUpdateSchema, updateStaff };
