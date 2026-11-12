'use strict';
const env = require('../config/env');
const Setting = require('../models/setting');
const Category = require('../models/category');
const Order = require('../models/order');
const Cart = require('../services/cart');
const { formatMoney, centsToInput } = require('../lib/money');
const dates = require('../lib/dates');
const html = require('../lib/html');
const { percentOff } = require('../services/pricing');
const { bpsToPercentLabel } = require('../services/tax');
const { formatPostal, PROVINCES } = require('../services/shipping');
const pkg = require('../../package.json');

const ASSET_VERSION = `${pkg.version}-${Date.now().toString(36)}`;

/** Digits only, for wa.me and tel: links. */
const digits = (s) => String(s || '').replace(/[^0-9+]/g, '');

/** Template helpers that never change between requests. */
const helpers = {
  money: formatMoney,
  centsToInput,
  dates,
  percentOff,
  bpsToPercentLabel,
  formatPostal,
  PROVINCES,
  truncate: html.truncate,
  stripTags: html.stripTags,
  jsonLd: html.jsonLd,
  digits,
  asset: (p) => `/assets/${p}?v=${ASSET_VERSION}`,
  upload: (p) => (p ? `/uploads/${String(p).split('/').map(encodeURIComponent).join('/')}` : '/assets/img/placeholder.svg'),
  STATUS_LABELS: Order.STATUS_LABELS,
  FULFILMENT_LABELS: Order.FULFILMENT_LABELS,
  PAYMENT_LABELS: Order.PAYMENT_LABELS,
  appUrl: env.appUrl,
  /** Rebuild the current URL with some query params changed (filters, sorting, pagination). */
  qs(query, changes) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, ...changes })) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
      else params.set(k, v);
    }
    const s = params.toString();
    return s ? `?${s}` : '?';
  },
};

/** Per-request view data shared by every storefront and admin page. */
async function locals(req, res, next) {
  try {
    const [settings, nav, cartCount] = await Promise.all([Setting.getAll(), Category.tree(), Cart.count(req)]);
    Object.assign(res.locals, helpers, {
      settings,
      nav,
      cartCount,
      path: req.path,
      query: req.query,
      canonical: `${env.appUrl}${req.path === '/' ? '' : req.path}`,
      title: null,
      metaDescription: null,
      ogImage: null,
      noindex: false,
      jsonLdBlocks: [],
      isAdminUser: Boolean(req.user && req.user.role !== 'customer'),
    });
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { locals, helpers };
