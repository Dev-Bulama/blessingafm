'use strict';
const env = require('../config/env');

/**
 * Minimal PayPal REST client (Orders API v2) using the built-in fetch. The customer is redirected
 * to PayPal to approve the payment, then we capture it server-to-server and trust only PayPal's
 * own response - never anything the browser tells us.
 */
let cachedToken = null;
let tokenExpiresAt = 0;

const isConfigured = () => Boolean(env.paypal.clientId && env.paypal.clientSecret);

class PaypalError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PaypalError';
    this.httpStatus = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body = null, headers = {}, auth = null } = {}) {
  const res = await fetch(`${env.paypal.apiBase}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body && typeof body === 'object' ? { 'Content-Type': 'application/json' } : {}), ...headers, Authorization: auth || `Bearer ${await getToken()}` },
    body: body && typeof body === 'object' ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { /* non-JSON error page */ }
  if (!res.ok) throw new PaypalError(`PayPal ${method} ${path} failed with ${res.status}${json && json.name ? ` (${json.name})` : ''}`, res.status, json);
  return json;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const basic = Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString('base64');
  const data = await request('/v1/oauth2/token', {
    method: 'POST', body: 'grant_type=client_credentials', auth: `Basic ${basic}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, (data.expires_in || 300) - 120) * 1000;
  return cachedToken;
}

const toAmount = (cents) => (cents / 100).toFixed(2);
/** "12.34" -> 1234 without floating point error. */
function toCents(value) {
  const [whole, frac = ''] = String(value).split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

/** Create a PayPal order for a store order. Returns { id, approveUrl }. */
async function createOrder(order, { returnUrl, cancelUrl, brandName }) {
  const data = await request('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `bam-${order.id}-${Date.now()}` },
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(order.id),
        custom_id: String(order.id),
        invoice_id: `${order.order_number}-${Date.now().toString(36)}`,
        description: `Order ${order.order_number}`.slice(0, 127),
        amount: { currency_code: 'CAD', value: toAmount(order.total_cents) },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: String(brandName || '').slice(0, 127), user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
            return_url: returnUrl, cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const link = (data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!data.id || !link) throw new PaypalError('PayPal did not return an approval link', 502, data);
  return { id: data.id, approveUrl: link.href };
}

/** Summarise a PayPal order/capture response into what the store needs. */
function summarise(data) {
  const unit = (data.purchase_units || [])[0] || {};
  const capture = ((unit.payments || {}).captures || [])[0] || null;
  return {
    id: data.id,
    status: data.status, // CREATED, APPROVED, COMPLETED, VOIDED...
    orderId: Number(unit.custom_id || unit.reference_id) || null,
    capture: capture ? {
      id: capture.id, status: capture.status,
      amountCents: toCents(capture.amount.value), currency: String(capture.amount.currency_code || '').toUpperCase(),
    } : null,
  };
}

const getOrder = async (paypalOrderId) => summarise(await request(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`));

/** Capture an approved order. If it was already captured, return its current state instead of failing. */
async function capture(paypalOrderId) {
  try {
    return summarise(await request(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST', body: {}, headers: { 'PayPal-Request-Id': `bam-capture-${paypalOrderId}` },
    }));
  } catch (err) {
    const issue = err.body && err.body.details && err.body.details[0] && err.body.details[0].issue;
    if (issue === 'ORDER_ALREADY_CAPTURED') return getOrder(paypalOrderId);
    throw err;
  }
}

module.exports = { isConfigured, createOrder, capture, getOrder, toCents, toAmount, PaypalError };
