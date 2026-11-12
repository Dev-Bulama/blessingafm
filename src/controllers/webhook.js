'use strict';
const env = require('../config/env');
const logger = require('../config/logger');
const { getStripe } = require('../config/stripe');
const OrderService = require('../services/order');

/**
 * POST /webhooks/stripe
 * The only place an online order is ever marked paid. The event is verified against the
 * webhook signing secret using the raw request body before anything is trusted.
 */
async function stripe(req, res) {
  const client = getStripe();
  if (!client || !env.stripe.webhookSecret) return res.status(503).send('Stripe is not configured');

  let event;
  try {
    event = client.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.stripe.webhookSecret);
  } catch (err) {
    logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
    return res.status(400).send('Invalid signature');
  }

  const session = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await OrderService.markPaidFromStripe(session);
      break;
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const orderId = Number(session.client_reference_id);
      if (orderId) await OrderService.cancelUnpaidStripeOrder(orderId, 'Payment was not completed - order cancelled automatically');
      break;
    }
    default:
      break;
  }
  return res.json({ received: true });
}

module.exports = { stripe };
