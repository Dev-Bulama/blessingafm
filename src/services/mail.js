'use strict';
const path = require('path');
const ejs = require('ejs');
const env = require('../config/env');
const logger = require('../config/logger');
const { getTransport } = require('../config/mail');
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
    const from = env.smtp.from || `${settings.store_name} <${env.smtp.user}>`;
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
  return s.order_notify_email || s.store_email || env.smtp.user;
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

module.exports = {
  send, sendOrderConfirmation, sendStoreNewOrder, sendStatusUpdate, sendVerifyEmail, sendPasswordReset,
  sendContactMessage, sendTest, orderUrl,
};
