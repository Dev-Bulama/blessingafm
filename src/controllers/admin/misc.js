'use strict';
const db = require('../../config/db');
const env = require('../../config/env');
const Setting = require('../../models/setting');
const Product = require('../../models/product');
const Audit = require('../../models/audit');
const Image = require('../../services/image');
const Mail = require('../../services/mail');
const Csv = require('../../services/csv');
const { getStripe } = require('../../config/stripe');
const { z, email: emailField } = require('../../middleware/validation');

const PER_PAGE = 50;
const pageOf = (req) => Math.max(1, Number.parseInt(req.query.page, 10) || 1);

// ---------- Reviews ----------

/** GET /admin/reviews */
async function reviews(req, res) {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const page = pageOf(req);
  const rows = await db('reviews as r').join('products as p', 'p.id', 'r.product_id').join('users as u', 'u.id', 'r.user_id')
    .where('r.status', status).select('r.*', 'p.name as product_name', 'p.slug as product_slug', 'u.first_name', 'u.last_name', 'u.email')
    .orderBy('r.id', 'desc').limit(PER_PAGE + 1).offset((page - 1) * PER_PAGE);
  const counts = await db('reviews').groupBy('status').select('status').count({ n: 'id' });
  res.render('admin/reviews', {
    title: 'Reviews', rows: rows.slice(0, PER_PAGE), hasMore: rows.length > PER_PAGE, page, status,
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
  });
}

const reviewActionSchema = z.object({ action: z.enum(['approve', 'reject', 'delete']), status: z.string().max(20).optional() });

/** POST /admin/reviews/:id */
async function moderateReview(req, res, next) {
  const review = await db('reviews').where({ id: Number(req.params.id) || 0 }).first();
  if (!review) return next();
  if (req.valid.action === 'delete') await db('reviews').where({ id: review.id }).del();
  else await db('reviews').where({ id: review.id }).update({ status: req.valid.action === 'approve' ? 'approved' : 'rejected' });
  await Product.refreshRating(review.product_id);
  await Audit.log(req, `review_${req.valid.action}`, 'reviews', review.id, { product_id: review.product_id });
  req.flash('success', `Review ${req.valid.action === 'delete' ? 'deleted' : req.valid.action === 'approve' ? 'approved and published' : 'rejected'}.`);
  return res.redirect(`/admin/reviews?status=${['pending', 'approved', 'rejected'].includes(req.valid.status) ? req.valid.status : 'pending'}`);
}

// ---------- Newsletter subscribers ----------

/** GET /admin/subscribers */
async function subscribers(req, res) {
  const page = pageOf(req);
  const [{ n }] = await db('newsletter_subscribers').where({ is_subscribed: true }).count({ n: 'id' });
  const rows = await db('newsletter_subscribers').orderBy('id', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
  const [{ total }] = await db('newsletter_subscribers').count({ total: 'id' });
  res.render('admin/subscribers', { title: 'Newsletter subscribers', rows, page, pages: Math.max(1, Math.ceil(Number(total) / PER_PAGE)), active: Number(n) });
}

/** GET /admin/subscribers/export.csv */
async function exportSubscribers(req, res) {
  const rows = await db('newsletter_subscribers').where({ is_subscribed: true }).orderBy('id').select('email', 'source', 'created_at');
  await Audit.log(req, 'export', 'newsletter_subscribers', null, { rows: rows.length });
  const out = rows.map((r) => ({ email: r.email, source: r.source || '', subscribed_at: new Date(r.created_at).toISOString() }));
  res.set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(`﻿${Csv.toCsv(['email', 'source', 'subscribed_at'], out)}`);
}

// ---------- Contact messages ----------

/** GET /admin/messages */
async function messages(req, res) {
  const page = pageOf(req);
  const rows = await db('contact_messages').orderBy('id', 'desc').limit(PER_PAGE + 1).offset((page - 1) * PER_PAGE);
  res.render('admin/messages', { title: 'Contact messages', rows: rows.slice(0, PER_PAGE), hasMore: rows.length > PER_PAGE, page });
}

const messageActionSchema = z.object({ action: z.enum(['read', 'unread', 'delete']) });

/** POST /admin/messages/:id */
async function updateMessage(req, res) {
  const id = Number(req.params.id) || 0;
  if (req.valid.action === 'delete') {
    await db('contact_messages').where({ id }).del();
    await Audit.log(req, 'message_delete', 'contact_messages', id);
  } else {
    await db('contact_messages').where({ id }).update({ is_read: req.valid.action === 'read' });
  }
  res.redirect('/admin/messages');
}

// ---------- Settings ----------

const flag = z.any().optional().transform((v) => (v === '1' || v === 'on' || v === true ? '1' : '0'));
const str = (max) => z.any().optional().transform((v) => String(v === undefined || v === null ? '' : v).trim().slice(0, max));
const url = z.any().optional().transform((v) => String(v || '').trim().slice(0, 255))
  .refine((v) => v === '' || /^https:\/\/[^\s<>"']+$/.test(v), 'Links must start with https://');
const optionalEmail = z.any().optional().transform((v) => String(v || '').trim().toLowerCase().slice(0, 190))
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address');

const settingsSchema = z.object({
  store_name: z.string().trim().min(1, 'Store name is required').max(120),
  store_tagline: str(160),
  store_address_line1: str(190),
  store_city: str(100),
  store_province: str(2),
  store_postal_code: str(40),
  store_phone: str(40),
  store_email: optionalEmail,
  store_whatsapp: str(30).refine((v) => v === '' || /^\+?[0-9\s()-]{10,20}$/.test(v), 'Enter the WhatsApp number with country code, e.g. +1 905 555 0100'),
  store_hours: str(1000),
  social_facebook: url,
  social_instagram: url,
  social_tiktok: url,
  meta_description: str(300),
  announcement_enabled: flag,
  announcement_text: str(200),
  tax_rate: z.any().optional().transform((v) => String(v || '').trim()).refine((v) => /^\d{1,2}(\.\d{1,3})?$/.test(v), 'Enter the tax rate as a percentage, e.g. 13'),
  tax_label: z.string().trim().min(1, 'Tax label is required').max(20),
  tax_shipping: flag,
  pickup_enabled: flag,
  delivery_enabled: flag,
  shipping_enabled: flag,
  pickup_days_ahead: z.coerce.number({ error: 'Enter a number of days' }).int().min(1).max(30).transform(String),
  pickup_lead_minutes: z.coerce.number({ error: 'Enter a number of minutes' }).int().min(0).max(2880).transform(String),
  payment_stripe_enabled: flag,
  payment_etransfer_enabled: flag,
  payment_instore_enabled: flag,
  etransfer_email: optionalEmail,
  etransfer_instructions: str(1000),
  order_notify_email: optionalEmail,
  payment_paypal_enabled: flag,
  notify_low_stock: flag,
  notify_daily_summary: flag,
  remind_abandoned_cart: flag,
  abandoned_cart_hours: z.coerce.number({ error: 'Enter a number of hours' }).int().min(1).max(168).transform(String),
  remind_pickup: flag,
  remind_etransfer: flag,
  etransfer_cancel_hours: z.coerce.number({ error: 'Enter a number of hours (0 = never)' }).int().min(0).max(720).transform(String),
  remind_review: flag,
  review_request_days: z.coerce.number({ error: 'Enter a number of days' }).int().min(1).max(60).transform(String),
  back_in_stock_enabled: flag,
});

/** GET /admin/settings */
function settings(req, res) {
  res.render('admin/settings', {
    title: 'Settings',
    status: {
      smtp: Boolean(env.smtp.host && env.smtp.user), smtpHost: env.smtp.host, smtpUser: env.smtp.user,
      stripe: Boolean(getStripe()), stripeLive: env.stripe.secretKey.startsWith('sk_live_'), stripeWebhook: Boolean(env.stripe.webhookSecret),
      paypal: require('../../services/paypal').isConfigured(), paypalLive: env.paypal.mode === 'live',
      sharp: Image.hasSharp(), cron: Boolean(env.cronToken) && !env.cronToken.startsWith('change-me'), appUrl: env.appUrl,
    },
  });
}

/** POST /admin/settings */
async function saveSettings(req, res) {
  const values = { ...req.valid };
  if (values.payment_etransfer_enabled === '1' && !values.etransfer_email) {
    req.flash('error', 'Enter the e-Transfer email address before enabling Interac e-Transfer.');
    return res.redirect('/admin/settings');
  }
  const current = await Setting.getAll();
  if (req.file) {
    const saved = await Image.saveImage(req.file, 'brand', { maxWidth: 600, thumbWidth: 300 });
    values.logo_path = saved.path;
    if (saved.thumb_path !== saved.path) await Image.removeFile(saved.thumb_path);
    if (current.logo_path) await Image.removeFile(current.logo_path);
  } else if (req.body.logo_remove === '1' && current.logo_path) {
    await Image.removeFile(current.logo_path);
    values.logo_path = '';
  }
  await Setting.setMany(values);
  const changed = Object.keys(values).filter((k) => String(current[k] ?? '') !== String(values[k]));
  await Audit.log(req, 'settings_update', 'settings', null, { changed });
  req.flash('success', 'Settings saved.');
  return res.redirect('/admin/settings');
}

const testEmailSchema = z.object({ to: emailField });

/** POST /admin/settings/test-email - "send test email" button */
async function testEmail(req, res) {
  try {
    await Mail.sendTest(req.valid.to);
    await Audit.log(req, 'smtp_test', 'settings', null, { to: req.valid.to, ok: true });
    req.flash('success', `Test email sent to ${req.valid.to}. Check the inbox (and the spam folder).`);
  } catch (err) {
    await Audit.log(req, 'smtp_test', 'settings', null, { to: req.valid.to, ok: false });
    req.flash('error', `The test email could not be sent: ${String(err.message || err).slice(0, 300)}`);
  }
  res.redirect('/admin/settings#email');
}

// ---------- Audit log ----------

/** GET /admin/audit */
async function audit(req, res) {
  const page = pageOf(req);
  const rows = await db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id')
    .select('a.*', 'u.first_name', 'u.last_name', 'u.email').orderBy('a.id', 'desc').limit(PER_PAGE + 1).offset((page - 1) * PER_PAGE);
  res.render('admin/audit', { title: 'Audit log', rows: rows.slice(0, PER_PAGE), hasMore: rows.length > PER_PAGE, page });
}

module.exports = {
  reviews, reviewActionSchema, moderateReview, subscribers, exportSubscribers, messages, messageActionSchema, updateMessage,
  settings, settingsSchema, saveSettings, testEmailSchema, testEmail, audit,
};
