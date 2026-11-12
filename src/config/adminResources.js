'use strict';
/**
 * Declarative definitions for the simple admin CRUD screens. Each resource is rendered by the
 * generic list/form views and validated by a zod schema built from its field list
 * (see src/controllers/admin/resource.js).
 *
 * Field types: text, textarea, richtext, number, money, bool, select, date, time, image, slug
 */
const Category = require('../models/category');
const { formatMoney, parseMoney, centsToInput } = require('../lib/money');
const dates = require('../lib/dates');
const { normalizeCode } = require('../services/coupon');
const { normalizePostal } = require('../services/shipping');

const yesNo = (v) => (v ? 'Yes' : 'No');
const fieldError = (field, message) => Object.assign(new Error(message), { fieldErrors: { [field]: message } });

const sortOrder = { name: 'sort_order', label: 'Sort order', type: 'number', min: 0, max: 100000, default: 0, help: 'Lower numbers appear first.' };
const active = { name: 'is_active', label: 'Active', type: 'bool', default: true };

module.exports = {
  categories: {
    table: 'categories', title: 'Categories', singular: 'Category', roles: ['admin', 'staff'],
    orderBy: [{ column: 'parent_id' }, { column: 'sort_order' }, { column: 'name' }],
    search: ['name', 'slug'],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'parent_name', label: 'Parent' },
      { key: 'sort_order', label: 'Order' },
      { key: 'is_featured', label: 'Featured', format: yesNo },
      { key: 'is_active', label: 'Active', format: yesNo },
    ],
    listQuery: (q) => q.leftJoin('categories as parent', 'parent.id', 'categories.parent_id').select('categories.*', 'parent.name as parent_name'),
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, max: 120 },
      { name: 'slug', label: 'URL slug', type: 'slug', from: 'name', help: 'Leave blank to generate from the name.' },
      {
        name: 'parent_id', label: 'Parent', type: 'select', numeric: true, nullable: true,
        help: 'Leave empty for a top-level department. Categories can be nested two levels below a department.',
        async options() {
          const tree = await Category.fullTree();
          return [['', '- None (department) -'], ...Category.flatten(tree).filter((c) => c.depth < 2).map((c) => [c.id, c.label])];
        },
      },
      { name: 'description', label: 'Description', type: 'textarea', max: 500 },
      { name: 'image', label: 'Image', type: 'image' },
      sortOrder,
      { name: 'is_featured', label: 'Featured on the home page', type: 'bool', default: false },
      active,
    ],
    async beforeSave(data, { id }) {
      if (data.parent_id) {
        const tree = await Category.fullTree();
        const parent = tree.byId.get(data.parent_id);
        if (!parent) throw fieldError('parent_id', 'Choose a valid parent');
        if (Category.trail(tree, parent).length > 2) throw fieldError('parent_id', 'Categories can only be nested two levels below a department');
        if (id) {
          const self = tree.byId.get(id);
          if (self && Category.descendantIds(self).includes(data.parent_id)) throw fieldError('parent_id', 'A category cannot be moved inside itself');
          if (self && self.children.some((c) => c.children.length) ) throw fieldError('parent_id', 'This category has two levels below it and cannot be nested');
          if (self && self.children.length && Category.trail(tree, parent).length > 1) throw fieldError('parent_id', 'This category has subcategories, so it can only sit directly under a department');
        }
      }
      return data;
    },
    afterChange: () => Category.invalidate(),
    deleteBlockedMessage: 'This category still has products or subcategories. Move or delete them first.',
  },

  brands: {
    table: 'brands', title: 'Brands', singular: 'Brand', roles: ['admin', 'staff'],
    orderBy: [{ column: 'sort_order' }, { column: 'name' }],
    search: ['name'],
    columns: [{ key: 'name', label: 'Name' }, { key: 'sort_order', label: 'Order' }, { key: 'is_active', label: 'Active', format: yesNo }],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, max: 120, unique: true },
      { name: 'slug', label: 'URL slug', type: 'slug', from: 'name', help: 'Leave blank to generate from the name.' },
      { name: 'image', label: 'Logo / image', type: 'image' },
      sortOrder,
      active,
    ],
  },

  coupons: {
    table: 'coupons', title: 'Coupons', singular: 'Coupon', roles: ['admin'],
    orderBy: [{ column: 'id', order: 'desc' }],
    search: ['code', 'description'],
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'value', label: 'Discount', format: (v, row) => (row.type === 'percent' ? `${v}%` : formatMoney(v)) },
      { key: 'min_spend_cents', label: 'Min. spend', format: (v) => formatMoney(v) },
      { key: 'expires_at', label: 'Expires', format: (v) => (v ? dates.formatDate(v) : 'Never') },
      { key: 'used_count', label: 'Used', format: (v, row) => `${v}${row.usage_limit ? ` / ${row.usage_limit}` : ''}` },
      { key: 'is_active', label: 'Active', format: yesNo },
    ],
    fields: [
      { name: 'code', label: 'Code', type: 'text', required: true, max: 40, unique: true, help: 'Letters and numbers, e.g. WELCOME10. Saved in capitals.' },
      { name: 'description', label: 'Description (internal)', type: 'text', max: 190 },
      { name: 'type', label: 'Type', type: 'select', required: true, options: [['percent', 'Percentage off'], ['fixed', 'Fixed amount off']] },
      { name: 'value', label: 'Value', type: 'text', required: true, max: 12, help: 'Percentage (e.g. 10) or dollar amount (e.g. 5.00), depending on the type.' },
      { name: 'min_spend_cents', label: 'Minimum spend ($)', type: 'money', default: 0 },
      { name: 'starts_at', label: 'Starts on', type: 'date', help: 'Optional. Store (Toronto) time.' },
      { name: 'expires_at', label: 'Expires at the end of', type: 'date', endOfDay: true, help: 'Optional.' },
      { name: 'usage_limit', label: 'Usage limit', type: 'number', min: 1, max: 1000000, nullable: true, help: 'Total number of orders that can use this code. Leave empty for unlimited.' },
      active,
    ],
    toForm(row) {
      return { ...row, value: row.type === 'fixed' ? centsToInput(row.value) : String(row.value) };
    },
    async beforeSave(data) {
      data.code = normalizeCode(data.code);
      if (!/^[A-Z0-9_-]{3,40}$/.test(data.code)) throw fieldError('code', 'Use 3 to 40 letters, numbers, dashes or underscores');
      if (data.type === 'percent') {
        const pct = Number(data.value);
        if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw fieldError('value', 'Enter a whole percentage between 1 and 100');
        data.value = pct;
      } else {
        const cents = parseMoney(data.value);
        if (cents === null || cents < 1) throw fieldError('value', 'Enter a dollar amount such as 5.00');
        data.value = cents;
      }
      if (data.starts_at && data.expires_at && data.expires_at < data.starts_at) throw fieldError('expires_at', 'The expiry date is before the start date');
      return data;
    },
  },

  'delivery-zones': {
    table: 'delivery_zones', title: 'Delivery zones', singular: 'Delivery zone', roles: ['admin'],
    orderBy: [{ column: 'sort_order' }, { column: 'name' }],
    columns: [
      { key: 'name', label: 'Zone' },
      { key: 'postal_prefixes', label: 'Postal prefixes' },
      { key: 'fee_cents', label: 'Fee', format: (v) => formatMoney(v) },
      { key: 'min_order_cents', label: 'Min. order', format: (v) => formatMoney(v) },
      { key: 'free_threshold_cents', label: 'Free from', format: (v) => (v === null ? 'Never' : formatMoney(v)) },
      { key: 'is_active', label: 'Active', format: yesNo },
    ],
    fields: [
      { name: 'name', label: 'Zone name', type: 'text', required: true, max: 120 },
      { name: 'postal_prefixes', label: 'Postal code prefixes', type: 'textarea', required: true, max: 1000, help: 'Comma separated, e.g. L3Y, L3X. Usually the first three characters (FSA). A longer prefix wins over a shorter one.' },
      { name: 'fee_cents', label: 'Delivery fee ($)', type: 'money', required: true },
      { name: 'min_order_cents', label: 'Minimum order ($)', type: 'money', default: 0 },
      { name: 'free_threshold_cents', label: 'Free delivery from ($)', type: 'money', nullable: true, help: 'Leave empty if delivery is never free in this zone.' },
      sortOrder,
      active,
    ],
    async beforeSave(data) {
      const prefixes = [...new Set(String(data.postal_prefixes).split(/[,\s]+/).map(normalizePostal).filter(Boolean))];
      if (!prefixes.length) throw fieldError('postal_prefixes', 'Enter at least one postal code prefix');
      const bad = prefixes.find((p) => !/^[A-Z](\d([A-Z](\d([A-Z]\d?)?)?)?)?$/.test(p));
      if (bad) throw fieldError('postal_prefixes', `"${bad}" is not a valid Canadian postal code prefix`);
      data.postal_prefixes = prefixes.join(', ');
      return data;
    },
  },

  'shipping-rates': {
    table: 'shipping_rates', title: 'Shipping rates', singular: 'Shipping rate', roles: ['admin'],
    orderBy: [{ column: 'min_weight_grams' }],
    intro: 'Flat Canada-wide shipping rates by total order weight. Make sure the bands do not overlap and that there are no gaps.',
    columns: [
      { key: 'name', label: 'Band' },
      { key: 'min_weight_grams', label: 'From (g)' },
      { key: 'max_weight_grams', label: 'To (g)' },
      { key: 'rate_cents', label: 'Rate', format: (v) => formatMoney(v) },
      { key: 'is_active', label: 'Active', format: yesNo },
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, max: 120, help: 'Shown to the customer, e.g. "Up to 2 kg".' },
      { name: 'min_weight_grams', label: 'From weight (grams)', type: 'number', required: true, min: 0, max: 1000000, default: 0 },
      { name: 'max_weight_grams', label: 'To weight (grams)', type: 'number', required: true, min: 1, max: 1000000 },
      { name: 'rate_cents', label: 'Rate ($)', type: 'money', required: true },
      active,
    ],
    async beforeSave(data) {
      if (data.max_weight_grams < data.min_weight_grams) throw fieldError('max_weight_grams', 'Must be greater than the "from" weight');
      return data;
    },
  },

  'pickup-slots': {
    table: 'pickup_slots', title: 'Pickup slots', singular: 'Pickup slot', roles: ['admin'],
    orderBy: [{ column: 'day_of_week' }, { column: 'start_time' }],
    intro: 'Weekly pickup windows customers can choose at checkout. Capacity is the number of orders accepted per window per day.',
    perPage: 100,
    columns: [
      { key: 'day_of_week', label: 'Day', format: (v) => dates.DAY_NAMES[v] },
      { key: 'start_time', label: 'From', format: (v) => dates.formatTime(v) },
      { key: 'end_time', label: 'To', format: (v) => dates.formatTime(v) },
      { key: 'capacity', label: 'Capacity' },
      { key: 'is_active', label: 'Active', format: yesNo },
    ],
    fields: [
      { name: 'day_of_week', label: 'Day of the week', type: 'select', numeric: true, required: true, options: dates.DAY_NAMES.map((d, i) => [i, d]) },
      { name: 'start_time', label: 'Start time', type: 'time', required: true },
      { name: 'end_time', label: 'End time', type: 'time', required: true },
      { name: 'capacity', label: 'Orders per slot', type: 'number', required: true, min: 1, max: 1000, default: 8 },
      active,
    ],
    toForm: (row) => ({ ...row, start_time: String(row.start_time).slice(0, 5), end_time: String(row.end_time).slice(0, 5) }),
    async beforeSave(data) {
      if (data.end_time <= data.start_time) throw fieldError('end_time', 'The end time must be after the start time');
      return data;
    },
  },

  banners: {
    table: 'banners', title: 'Hero banners', singular: 'Banner', roles: ['admin'],
    orderBy: [{ column: 'sort_order' }, { column: 'id' }],
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'theme', label: 'Colour' },
      { key: 'cta_url', label: 'Link' },
      { key: 'sort_order', label: 'Order' },
      { key: 'is_active', label: 'Active', format: yesNo },
    ],
    fields: [
      { name: 'title', label: 'Headline', type: 'text', required: true, max: 120 },
      { name: 'subtitle', label: 'Sub-headline', type: 'text', max: 255 },
      { name: 'cta_label', label: 'Button text', type: 'text', max: 60 },
      { name: 'cta_url', label: 'Button link', type: 'text', max: 255, help: 'A path on this site such as /c/food-market or /shop?deal=1.' },
      { name: 'theme', label: 'Background colour', type: 'select', required: true, options: [['yellow', 'Yellow'], ['red', 'Red'], ['green', 'Green'], ['black', 'Black']] },
      { name: 'image', label: 'Image (optional)', type: 'image', help: 'Shown beside the text on large screens. Landscape, at least 800 px wide.' },
      sortOrder,
      active,
    ],
    async beforeSave(data) {
      if (data.cta_url && !/^(\/(?!\/)|https:\/\/)/.test(data.cta_url)) throw fieldError('cta_url', 'Start with / for a page on this site, or https:// for an external link');
      return data;
    },
  },

  pages: {
    table: 'pages', title: 'Pages', singular: 'Page', roles: ['admin'],
    orderBy: [{ column: 'title' }],
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'slug', label: 'URL', format: (v) => `/${v}` },
      { key: 'is_published', label: 'Published', format: yesNo },
      { key: 'updated_at', label: 'Updated', format: (v) => dates.formatDate(v) },
    ],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, max: 190 },
      { name: 'slug', label: 'URL slug', type: 'slug', from: 'title', lockOnEdit: true, help: 'The page address, e.g. "about" gives /about. Cannot be changed later.' },
      { name: 'body_html', label: 'Content', type: 'richtext' },
      { name: 'meta_title', label: 'SEO title', type: 'text', max: 190, help: 'Optional. Defaults to the page title.' },
      { name: 'meta_description', label: 'SEO description', type: 'textarea', max: 300, rows: 2 },
      { name: 'is_published', label: 'Published', type: 'bool', default: true },
    ],
    async beforeSave(data, { id }) {
      const reserved = ['admin', 'account', 'cart', 'checkout', 'order', 'shop', 'search', 'c', 'p', 'faq', 'assets', 'uploads', 'cron',
        'webhooks', 'newsletter', 'wishlist', 'healthz', 'sitemap.xml', 'robots.txt'];
      if (!id && reserved.includes(data.slug)) throw fieldError('slug', 'That address is reserved. Choose a different slug.');
      return data;
    },
    async canDelete(row) {
      return ['contact'].includes(row.slug) ? 'The contact page text is used by the contact form and cannot be deleted. Unpublish it instead.' : null;
    },
  },

  faqs: {
    table: 'faqs', title: 'FAQs', singular: 'FAQ', roles: ['admin'],
    orderBy: [{ column: 'sort_order' }, { column: 'id' }],
    columns: [{ key: 'question', label: 'Question' }, { key: 'sort_order', label: 'Order' }, { key: 'is_active', label: 'Active', format: yesNo }],
    fields: [
      { name: 'question', label: 'Question', type: 'text', required: true, max: 255 },
      { name: 'answer', label: 'Answer', type: 'textarea', required: true, max: 5000, rows: 6 },
      sortOrder,
      active,
    ],
  },
};

