'use strict';
const crypto = require('crypto');
const env = require('../config/env');

const COOKIE = 'bam.csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const sign = (value) => crypto.createHmac('sha256', env.sessionSecret).update(value).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function isValid(token) {
  if (typeof token !== 'string') return false;
  const [value, mac] = token.split('.');
  if (!value || !mac || mac.length !== 64) return false;
  const expected = sign(value);
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * CSRF protection using a signed double-submit cookie. The token lives in an httpOnly cookie and
 * must be echoed back by every state-changing request, either as the `_csrf` form field or the
 * `X-CSRF-Token` header. Multipart (file upload) forms pass it in the query string because their
 * body is parsed later by multer.
 */
function csrfProtection(req, res, next) {
  let token = readCookie(req, COOKIE);
  if (!isValid(token)) {
    const value = crypto.randomBytes(24).toString('hex');
    token = `${value}.${sign(value)}`;
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/', maxAge: 14 * 24 * 3600 * 1000 });
    if (!SAFE.has(req.method)) return reject(req, res, next);
  }
  res.locals.csrfToken = token;
  if (SAFE.has(req.method)) return next();

  const isMultipart = (req.headers['content-type'] || '').startsWith('multipart/form-data');
  const sent = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || (isMultipart ? req.query._csrf : null);
  if (!sent || !safeEqual(sent, token)) return reject(req, res, next);
  return next();
}

function reject(req, res, next) {
  const err = new Error('Your session expired or the form was open for too long. Please go back, refresh the page and try again.');
  err.status = 403;
  err.expose = true;
  err.code = 'EBADCSRFTOKEN';
  next(err);
}

module.exports = { csrfProtection };
