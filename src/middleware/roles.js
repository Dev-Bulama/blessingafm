'use strict';

function deny(req, res) {
  if (!req.user) {
    return res.redirect(`/account/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  const err = new Error('You do not have permission to view this page.');
  err.status = 403;
  err.expose = true;
  throw err;
}

/** Admin panel access: staff and admins. */
function requireStaff(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'staff')) return next();
  return deny(req, res);
}

/** Admin-only areas: settings, customers, content, coupons, zones, staff, audit log. */
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return deny(req, res);
}

module.exports = { requireStaff, requireAdmin };
