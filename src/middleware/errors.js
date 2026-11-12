'use strict';
const logger = require('../config/logger');
const env = require('../config/env');

function notFound(req, res) {
  res.status(404);
  if (req.xhr || req.accepts(['html', 'json']) === 'json') return res.json({ ok: false, message: 'Not found' });
  return res.render('errors/404', { layout: layoutFor(req), title: 'Page not found', noindex: true });
}

function layoutFor(req) {
  return req.originalUrl.startsWith('/admin') && req.user && req.user.role !== 'customer' ? 'layouts/admin' : 'layouts/store';
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.expose ? err.message : null;

  if (err.code === 'LIMIT_FILE_SIZE') { status = 400; message = 'That file is too large. The maximum size is 5 MB per image.'; }
  else if (err.code && String(err.code).startsWith('LIMIT_')) { status = 400; message = 'Upload rejected: too many files or fields.'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'The submitted form is too large.'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'The request could not be read.'; }

  if (status >= 500) logger.error(`${req.method} ${req.originalUrl}`, err);
  else if (status !== 404) logger.warn(`${status} ${req.method} ${req.originalUrl}: ${err.message}`);

  if (res.headersSent) return res.end();
  res.status(status);
  if (req.xhr || req.accepts(['html', 'json']) === 'json') {
    return res.json({ ok: false, message: message || 'Something went wrong. Please try again.' });
  }
  if (status === 404) return res.render('errors/404', { layout: layoutFor(req), title: 'Page not found', noindex: true });
  // Views rely on locals that may not exist if the failure happened early (e.g. the database is down).
  const safe = res.locals.settings ? {} : { layout: false, bare: true };
  return res.render('errors/500', {
    layout: layoutFor(req),
    ...safe,
    title: status >= 500 ? 'Something went wrong' : 'There was a problem',
    status,
    message: message || 'Something went wrong on our side. Please try again in a moment.',
    stack: !env.isProd && status >= 500 ? err.stack : null,
    noindex: true,
  }, (renderErr, html) => {
    if (renderErr) {
      logger.error('error page failed to render', renderErr);
      return res.type('text').send(message || 'Something went wrong. Please try again in a moment.');
    }
    return res.send(html);
  });
}

module.exports = { notFound, errorHandler };
