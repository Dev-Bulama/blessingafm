'use strict';
const User = require('../models/user');

/** Attach req.user from the session. Disabled or deleted accounts are signed out. */
async function loadUser(req, res, next) {
  try {
    req.user = null;
    if (req.session && req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (user && !user.is_disabled) {
        delete user.password_hash;
        req.user = user;
      } else {
        delete req.session.userId;
      }
    }
    res.locals.currentUser = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Only allow same-site relative redirect targets. */
function safeNext(value, fallback = '/account') {
  const s = String(value || '');
  return /^\/(?![/\\])[\w\-./?=&%]*$/.test(s) ? s : fallback;
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect(`/account/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.xhr || req.accepts(['html', 'json']) === 'json') return res.status(401).json({ ok: false, message: 'Please sign in first.', login: '/account/login' });
  req.flash('error', 'Please sign in to continue.');
  return res.redirect('/account/login');
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/account');
  return next();
}

/** Start an authenticated session. The session id is regenerated to prevent fixation. */
function signIn(req, user) {
  return new Promise((resolve, reject) => {
    const cartId = req.session.cartId;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      if (cartId) req.session.cartId = cartId;
      return resolve();
    });
  });
}

function signOut(req) {
  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

module.exports = { loadUser, requireLogin, requireGuest, signIn, signOut, safeNext };
