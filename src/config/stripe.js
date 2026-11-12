'use strict';
const env = require('./env');

let client = null;

/** Returns a Stripe client, or null when no secret key is configured. */
function getStripe() {
  // Placeholder values ("test", the .env.example sample...) count as not configured, so the card
  // option stays hidden until a real key is entered.
  if (!isRealKey(env.stripe.secretKey)) return null;
  if (!client) client = require('stripe')(env.stripe.secretKey);
  return client;
}

/** Real Stripe secret keys look like sk_test_..., sk_live_... or rk_... and are long. */
function isRealKey(key) {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.test(String(key || '')) && !String(key).endsWith('_xxx');
}

module.exports = { getStripe, isRealKey };
