'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validate } = require('../middleware/validation');
const { requireLogin } = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const home = require('../controllers/home');
const catalog = require('../controllers/catalog');
const content = require('../controllers/content');

const router = express.Router();

router.get('/', asyncHandler(home.index));

// Catalogue
router.get('/shop', asyncHandler(catalog.shop));
router.get('/c/:slug', asyncHandler(catalog.category));
router.get('/search', limits.search, asyncHandler(catalog.search));
router.get('/search/suggest', limits.search, asyncHandler(catalog.suggest));
router.get('/p/:slug', asyncHandler(catalog.product));
router.post('/p/:slug/reviews', requireLogin, limits.review,
  validate(catalog.reviewSchema, { back: (req) => `/p/${encodeURIComponent(req.params.slug)}#reviews` }),
  asyncHandler(catalog.createReview));
router.post('/p/:slug/notify', limits.newsletter, validate(catalog.stockAlertSchema, { back: (req) => `/p/${encodeURIComponent(req.params.slug)}` }), asyncHandler(catalog.stockAlert));
router.post('/wishlist/toggle/:productId', requireLogin, asyncHandler(catalog.toggleWishlist));

// Content
router.get('/faq', asyncHandler(content.faq));
router.get('/contact', asyncHandler(content.contact));
router.post('/contact', limits.contact, validate(content.contactSchema, { back: '/contact' }), asyncHandler(content.sendContact));
router.post('/newsletter/subscribe', limits.newsletter, validate(content.newsletterSchema, { back: '/#newsletter' }), asyncHandler(content.subscribe));
router.get('/email/unsubscribe/:id/:sig', asyncHandler(content.unsubscribeReminders));
router.get('/newsletter/unsubscribe/:token', asyncHandler(content.unsubscribe));

// CMS pages last: /about, /shipping-delivery, /returns-refunds, /privacy-policy, /terms
router.get('/:slug', asyncHandler(content.page));

module.exports = router;
