'use strict';
const path = require('path');
const ejs = require('ejs');
const env = require('../config/env');
const logger = require('../config/logger');
const crypto = require('crypto');
const { getTransport, isConfigured } = require('../config/mail');
const Setting = require('../models/setting');
const Order = require('../models/order');
const { formatMoney } = require('../lib/money');
const dates = require('../lib/dates');
const { stripTags } = require('../lib/html');
const { bpsToPercentLabel } = require('./tax');
const { formatPostal } = require('./shipping');

const VIEWS = path.join(__dirname, '..', 'views', 'emails');

async function render(template, data) {
  const settings = await Setting.getAll();
  const locals = {
    ...data, settings, appUrl: env.appUrl, money: formatMoney, dates, bpsToPercentLabel, formatPostal,
    STATUS_LABELS: Order.STATUS_LABELS, FULFILMENT_LABELS: Order.FULFILMENT_LABELS, PAYMENT_LABELS: Order.PAYMENT_LABELS,
  };
  const body = await ejs.renderFile(path.join(VIEWS, `${template}.ejs`), locals);
  const html = await ejs.renderFile(path.join(VIEWS, '_layout.ejs'), { ...locals, body });
  return { html, settings };
}

/**
 * Send a templated email. Returns true on success. Errors are logged and swallowed unless
 * `throwOnError` is set, so a mail outage can never break checkout.
 */
async function send({ to, subject, template, data = {}, replyTo = null, throwOnError = false }) {
  try {
    const { html, settings } = await render(template, { ...data, subject });
    const transport = getTransport();
    if (!transport) {
      logger.warn(`SMTP not configured - email "${subject}" to ${to} was not sent`);
      if (throwOnError) throw new Error('SMTP is not configured. Set the SMTP_* environment variables.');
      return false;
    }
    const from = env.smtp.from || `${settings.store_name} <${env.smtp.user || 'no-reply@localhost'}>`;
    if (env.mailTransport === 'log') logger.info(`MAIL (not sent, MAIL_TRANSPORT=log) to=${to} subject="${subject}"`);
    await transport.sendMail({
      from, to, subject, html, replyTo: replyTo || settings.store_email || undefined,
      text: stripTags(html.replace(/<(br|\/p|\/tr|\/h\d|\/div)[^>]*>/gi, '\n')).slice(0, 20000),
    });
    return true;
  } catch (err) {
    logger.error(`Failed to send email "${subject}" to ${to}`, err);
    if (throwOnError) throw err;
    return false;
  }
}

function orderUrl(order) {
  return `${env.appUrl}/order/${order.order_number}?t=${order.access_token}`;
}

async function storeAddress() {
  const s = await Setting.getAll();
  const to = s.order_notify_email || s.store_email || env.smtp.user;
  return to && !to.startsWith('placeholder@') ? to : (env.smtp.user || null); // never mail the seed placeholder address
}

async function sendOrderConfirmation(order) {
  return send({
    to: order.email,
    subject: `Order ${order.order_number} received - thank you!`,
    template: 'order-confirmation',
    data: { order, orderUrl: orderUrl(order) },
  });
}

async function sendStoreNewOrder(order) {
  const to = await storeAddress();
  if (!to) return false;
  return send({
    to,
    subject: `New order ${order.order_number} (${formatMoney(order.total_cents)}, ${Order.FULFILMENT_LABELS[order.fulfilment_method]})`,
    template: 'store-new-order',
    data: { order, adminUrl: `${env.appUrl}/admin/orders/${order.id}` },
    replyTo: order.email,
  });
}

async function sendStatusUpdate(order, note = '') {
  return send({
    to: order.email,
    subject: `Order ${order.order_number}: ${Order.STATUS_LABELS[order.status]}`,
    template: 'order-status',
    data: { order, note, orderUrl: orderUrl(order) },
  });
}

async function sendVerifyEmail(user, token) {
  return send({
    to: user.email,
    subject: 'Confirm your email address',
    template: 'verify-email',
    data: { user, link: `${env.appUrl}/account/verify/${token}` },
  });
}

async function sendPasswordReset(user, token) {
  return send({
    to: user.email,
    subject: 'Reset your password',
    template: 'reset-password',
    data: { user, link: `${env.appUrl}/account/reset/${token}` },
  });
}

async function sendContactMessage(message) {
  const to = await storeAddress();
  if (!to) return false;
  return send({
    to,
    subject: `Website enquiry: ${message.subject || 'New message'}`,
    template: 'contact-message',
    data: { message },
    replyTo: message.email,
  });
}

async function sendTest(to) {
  return send({ to, subject: 'SMTP test email', template: 'test', throwOnError: true });
}

// ---------- Alerts and reminders ----------

/** Signed link that lets a customer opt out of reminder emails without signing in. */
function unsubscribeUrl(userId) {
  const sig = crypto.createHmac('sha256', env.sessionSecret).update(`unsubscribe:${userId}`).digest('hex').slice(0, 32);
  return `${env.appUrl}/email/unsubscribe/${userId}/${sig}`;
}
function verifyUnsubscribe(userId, sig) {
  const expected = crypto.createHmac('sha256', env.sessionSecret).update(`unsubscribe:${userId}`).digest('hex').slice(0, 32);
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendLowStockAlert(items, order = null) {
  const to = await storeAddress();
  if (!to) return false;
  return send({
    to,
    subject: `Low stock: ${items.length === 1 ? items[0].name : `${items.length} items`}`,
    template: 'low-stock',
    data: { items, order, inventoryUrl: `${env.appUrl}/admin/inventory?low=1` },
  });
}

async function sendDailySummary(summary) {
  const to = await storeAddress();
  if (!to) return false;
  return send({ to, subject: `Daily summary: ${summary.toPrepare} to prepare, ${summary.pickupsToday.length} pickups today`, template: 'daily-summary', data: { summary, adminUrl: `${env.appUrl}/admin` } });
}

const sendAbandonedCart = (user, items, subtotalCents) => send({
  to: user.email,
  subject: 'You left something in your cart',
  template: 'abandoned-cart',
  data: { user, items, subtotalCents, cartUrl: `${env.appUrl}/cart`, unsubscribe: unsubscribeUrl(user.id) },
});

const sendPickupReminder = (order, isToday) => send({
  to: order.email,
  subject: `Pickup reminder: order ${order.order_number} ${isToday ? 'today' : 'tomorrow'}`,
  template: 'pickup-reminder',
  data: { order, isToday, orderUrl: orderUrl(order) },
});

const sendPaymentReminder = (order) => send({
  to: order.email,
  subject: `Payment reminder for order ${order.order_number}`,
  template: 'payment-reminder',
  data: { order, orderUrl: orderUrl(order) },
});

const sendReviewRequest = (order, user, products) => send({
  to: user.email,
  subject: 'How was your order? Leave a quick review',
  template: 'review-request',
  data: { order, user, products, unsubscribe: unsubscribeUrl(user.id) },
});

const sendBackInStock = (email, product) => send({
  to: email,
  subject: `Back in stock: ${product.name}`,
  template: 'back-in-stock',
  data: { product, productUrl: `${env.appUrl}/p/${product.slug}` },
});

module.exports = {
  send, isConfigured, sendOrderConfirmation, sendStoreNewOrder, sendStatusUpdate, sendVerifyEmail, sendPasswordReset,
  sendContactMessage, sendTest, orderUrl, unsubscribeUrl, verifyUnsubscribe, sendLowStockAlert, sendDailySummary,
  sendAbandonedCart, sendPickupReminder, sendPaymentReminder, sendReviewRequest, sendBackInStock,
};
