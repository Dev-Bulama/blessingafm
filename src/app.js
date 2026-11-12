'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const expressLayouts = require('express-ejs-layouts');

const env = require('./config/env');
const logger = require('./config/logger');
const sessionMiddleware = require('./config/session');
const { csrfProtection } = require('./middleware/csrf');
const flash = require('./middleware/flash');
const { loadUser } = require('./middleware/auth');
const { locals } = require('./middleware/locals');
const { notFound, errorHandler } = require('./middleware/errors');
const Embed = require('./lib/embed');

fs.mkdirSync(env.uploadDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // hPanel serves the app behind its own reverse proxy
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('layout', 'layouts/store');
app.set('layout extractScripts', false);
if (env.isProd) app.set('view cache', true);

// Automated tests point PAYPAL_API_BASE at a local mock; allow its redirect too. Never set in production.
const paypalTestOrigin = process.env.PAYPAL_API_BASE && !env.isProd ? [new URL(process.env.PAYPAL_API_BASE).origin] : [];

const FORM_ACTION = ["'self'", 'https://checkout.stripe.com', 'https://www.paypal.com', 'https://www.sandbox.paypal.com', ...paypalTestOrigin];

// ---------- Security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.google.com'], // store map embed
      formAction: FORM_ACTION, // redirects to hosted Stripe Checkout / PayPal
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: env.isProd ? { maxAge: 15552000, includeSubDomains: false } : false,
}));

app.use(compression());

// ---------- Request log (rotated daily; CSRF tokens are kept out of the log) ----------
morgan.token('safe-url', (req) => req.originalUrl.replace(/([?&]_csrf=)[^&]*/g, '$1[redacted]').replace(/([?&](?:t|token)=)[^&]*/g, '$1[redacted]'));
app.use(morgan(':remote-addr :method :safe-url :status :res[content-length] - :response-time ms ":user-agent"', {
  stream: logger.accessStream,
  skip: (req) => req.path.startsWith('/assets/') || req.path.startsWith('/uploads/'),
}));

// ---------- Static files ----------
app.use('/assets', express.static(path.join(__dirname, 'public'), {
  maxAge: env.isProd ? '30d' : 0,
  immutable: env.isProd,
  index: false,
}));
app.use('/uploads', express.static(env.uploadDir, {
  maxAge: env.isProd ? '7d' : 0,
  index: false,
  dotfiles: 'ignore',
  setHeaders(res) {
    // Uploaded files are never allowed to run script, whatever their type.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/assets/img/favicon.svg'));

// ---------- Routes that must not use sessions, CSRF or the JSON/urlencoded parsers ----------
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use('/webhooks', require('./routes/webhooks')); // needs the raw request body
app.use('/cron', require('./routes/cron'));
app.use(require('./routes/seo'));

// ---------- Body parsing, session, CSRF ----------
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 6000 }));
app.use(express.json({ limit: '100kb' }));
app.use(sessionMiddleware);
app.use(flash);
app.use(loadUser);
app.use(locals);
app.use(expressLayouts);
app.use(csrfProtection);

// Chat widgets / analytics added by an admin in Settings. Every script tag carries a per-request
// nonce. Only pages that actually load a widget get the wider policy; admin, account, checkout and
// order pages always keep the strict one set by helmet above.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  const scripts = Embed.scriptsFor(res.locals.settings, req.path);
  res.locals.embedHtml = scripts.length ? Embed.renderEmbed(scripts, res.locals.cspNonce) : '';
  if (scripts.length && req.method === 'GET') {
    res.setHeader('Content-Security-Policy', Embed.widgetCsp(res.locals.cspNonce, { formAction: FORM_ACTION, upgradeInsecure: env.isProd }));
  }
  next();
});

// ---------- Application routes ----------
app.use('/admin', require('./routes/admin'));
app.use('/account', require('./routes/account'));
app.use('/cart', require('./routes/cart'));
app.use(require('./routes/checkout'));
app.use(require('./routes/store'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
