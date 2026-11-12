'use strict';

/**
 * Session-backed flash messages plus "old input" and field errors for redisplaying forms.
 * Nothing is written to the session unless a message is actually set.
 */
module.exports = function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ type, message });
  };
  // Called by the layout, so messages are consumed only when a page is really rendered.
  res.locals.takeFlash = () => {
    const messages = req.session.flash || [];
    if (req.session.flash) delete req.session.flash;
    return messages;
  };
  const form = req.session.form || null;
  if (form && req.method === 'GET') delete req.session.form;
  res.locals.old = (form && req.method === 'GET' && form.old) || {};
  res.locals.errors = (form && req.method === 'GET' && form.errors) || {};
  next();
};
