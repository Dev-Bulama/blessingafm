'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const webhook = require('../controllers/webhook');

const router = express.Router();

// Stripe signatures are computed over the exact bytes sent, so this route gets the raw body.
router.post('/stripe', express.raw({ type: '*/*', limit: '1mb' }), asyncHandler(webhook.stripe));

module.exports = router;
