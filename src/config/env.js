'use strict';
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('change-me'))) {
  throw new Error('SESSION_SECRET must be set to a long random value in production');
}

module.exports = {
  root,
  nodeEnv,
  isProd,
  port: Number(process.env.PORT || 3000),
  appUrl: (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : isProd,
  uploadDir: process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(root, 'uploads'),
  logDir: process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(root, 'logs'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE || '1') === '1',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    mode: process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
    // PAYPAL_API_BASE is only for automated tests against a mock server.
    apiBase: process.env.PAYPAL_API_BASE || (process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
  },
  mailTransport: process.env.MAIL_TRANSPORT || 'smtp',
  cronToken: process.env.CRON_TOKEN || '',
};
