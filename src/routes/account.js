'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validate } = require('../middleware/validation');
const { requireLogin, requireGuest } = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const auth = require('../controllers/auth');
const account = require('../controllers/account');

const router = express.Router();

// Account pages are private: never cache them.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------- Authentication ----------
router.get('/login', requireGuest, auth.showLogin);
router.post('/login', requireGuest, limits.login, validate(auth.loginSchema, { back: '/account/login' }), asyncHandler(auth.login));
router.get('/register', requireGuest, auth.showRegister);
router.post('/register', requireGuest, limits.register, validate(auth.registerSchema, { back: '/account/register' }), asyncHandler(auth.register));
router.post('/logout', asyncHandler(auth.logout));
router.get('/verify/:token', asyncHandler(auth.verify));
router.post('/verify/resend', requireLogin, limits.passwordReset, asyncHandler(auth.resendVerification));
router.get('/forgot', requireGuest, auth.showForgot);
router.post('/forgot', requireGuest, limits.passwordReset, validate(auth.forgotSchema, { back: '/account/forgot' }), asyncHandler(auth.forgot));
router.get('/reset/:token', asyncHandler(auth.showReset));
router.post('/reset/:token', limits.passwordReset,
  validate(auth.resetSchema, { back: (req) => `/account/reset/${encodeURIComponent(req.params.token)}` }), asyncHandler(auth.reset));

// ---------- Signed-in customer area ----------
router.use(requireLogin);
router.get('/', asyncHandler(account.dashboard));
router.get('/orders', asyncHandler(account.orders));
router.get('/orders/:number', asyncHandler(account.orderDetail));
router.post('/orders/:number/reorder', asyncHandler(account.reorder));
router.get('/addresses', asyncHandler(account.addresses));
router.get('/addresses/new', asyncHandler(account.addressForm));
router.post('/addresses', validate(account.addressSchema, { back: '/account/addresses/new' }), asyncHandler(account.saveAddress));
router.get('/addresses/:id/edit', asyncHandler(account.addressForm));
router.post('/addresses/:id', validate(account.addressSchema, { back: (req) => `/account/addresses/${Number(req.params.id) || 0}/edit` }), asyncHandler(account.saveAddress));
router.post('/addresses/:id/delete', asyncHandler(account.deleteAddress));
router.get('/wishlist', asyncHandler(account.wishlist));
router.get('/profile', account.profile);
router.post('/profile', validate(account.profileSchema, { back: '/account/profile' }), asyncHandler(account.saveProfile));
router.post('/password', limits.login, validate(account.passwordSchema, { back: '/account/profile' }), asyncHandler(account.changePassword));

module.exports = router;
