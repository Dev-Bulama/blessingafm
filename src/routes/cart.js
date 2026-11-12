'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validate } = require('../middleware/validation');
const cart = require('../controllers/cart');

const router = express.Router();

router.get('/', asyncHandler(cart.show));
router.get('/drawer', asyncHandler(cart.drawer));
router.post('/add', validate(cart.addSchema, { back: '/cart' }), asyncHandler(cart.add));
router.post('/update', validate(cart.updateSchema, { back: '/cart' }), asyncHandler(cart.update));
router.post('/remove', validate(cart.removeSchema, { back: '/cart' }), asyncHandler(cart.remove));
router.post('/coupon', validate(cart.couponSchema, { back: '/cart' }), asyncHandler(cart.applyCoupon));
router.post('/coupon/remove', asyncHandler(cart.removeCoupon));

module.exports = router;
