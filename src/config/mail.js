'use strict';
const nodemailer = require('nodemailer');
const env = require('./env');

let transporter = null;

/** Returns a Nodemailer transport, or null when SMTP is not configured. */
function getTransport() {
  if (!env.smtp.host || !env.smtp.user) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.password },
      pool: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

module.exports = { getTransport };
