'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validate } = require('../middleware/validation');
const limits = require('../middleware/rateLimits');
const checkout = require('../controllers/checkout');

const router = express.Router();

router.get('/checkout', asyncHandler(checkout.show));
router.post('/checkout/quote', validate(checkout.quoteSchema), asyncHandler(checkout.quote));
router.post('/checkout', limits.checkout, validate(checkout.checkoutSchema, { back: '/checkout' }), asyncHandler(checkout.place));

router.get('/checkout/paypal/return', limits.checkout, asyncHandler(checkout.paypalReturn));
router.get('/track-order', checkout.trackForm);
router.post('/track-order', limits.contact, validate(checkout.trackSchema, { back: '/track-order' }), asyncHandler(checkout.track));

router.get('/order/:number', asyncHandler(checkout.orderPage));
router.get('/order/:number/invoice', asyncHandler(checkout.invoice));
router.post('/order/:number/pay', limits.checkout, asyncHandler(checkout.payAgain));

module.exports = router;
