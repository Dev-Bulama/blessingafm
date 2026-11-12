'use strict';
const rateLimit = require('express-rate-limit');

function limiter({ windowMinutes, max, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(req, res) {
      if (req.xhr || req.is('json')) return res.status(429).json({ ok: false, message });
      const err = new Error(message);
      err.status = 429;
      err.expose = true;
      throw err;
    },
  });
}

// In-memory counters: fine for a single small Node process, no Redis required.
module.exports = {
  login: limiter({ windowMinutes: 15, max: 10, message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }),
  register: limiter({ windowMinutes: 60, max: 10, message: 'Too many accounts created from this connection. Please try again later.' }),
  passwordReset: limiter({ windowMinutes: 60, max: 6, message: 'Too many password reset requests. Please try again in an hour.' }),
  contact: limiter({ windowMinutes: 60, max: 8, message: 'Too many messages sent. Please try again later or call the store.' }),
  checkout: limiter({ windowMinutes: 15, max: 20, message: 'Too many checkout attempts. Please wait a few minutes and try again.' }),
  newsletter: limiter({ windowMinutes: 60, max: 10, message: 'Too many requests. Please try again later.' }),
  review: limiter({ windowMinutes: 60, max: 10, message: 'Too many reviews submitted. Please try again later.' }),
  search: limiter({ windowMinutes: 1, max: 60, message: 'Too many searches. Please slow down.' }),
};
