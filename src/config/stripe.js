'use strict';
const env = require('./env');

let client = null;

/** Returns a Stripe client, or null when no secret key is configured. */
function getStripe() {
  if (!env.stripe.secretKey || env.stripe.secretKey.endsWith('_xxx')) return null;
  if (!client) client = require('stripe')(env.stripe.secretKey);
  return client;
}

module.exports = { getStripe };
