'use strict';
const crypto = require('crypto');
const express = require('express');
const env = require('../config/env');
const logger = require('../config/logger');
const asyncHandler = require('../lib/asyncHandler');
const cleanup = require('../services/cleanup');

const router = express.Router();
let running = false;

function tokenOk(given) {
  if (!env.cronToken || env.cronToken.startsWith('change-me')) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(env.cronToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /cron/cleanup?token=CRON_TOKEN  (or header "X-Cron-Token")
 * Called by an hPanel cron job. Removes abandoned carts and expired sessions and releases stock
 * held by unpaid card orders.
 */
router.all('/cleanup', asyncHandler(async (req, res) => {
  if (!tokenOk(req.query.token || req.headers['x-cron-token'])) return res.status(403).type('text').send('Forbidden');
  if (running) return res.status(429).type('text').send('Cleanup already running');
  running = true;
  try {
    const result = await cleanup.run();
    logger.info(`cron cleanup: ${JSON.stringify(result)}`);
    return res.json({ ok: true, ...result });
  } finally {
    running = false;
  }
}));

module.exports = router;
