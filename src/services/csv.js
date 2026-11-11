'use strict';
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const PRODUCT_COLUMNS = ['sku', 'name', 'category_slug', 'brand', 'price', 'compare_at_price', 'stock', 'low_stock_threshold',
  'weight_grams', 'is_taxable', 'is_perishable', 'is_frozen', 'pickup_only', 'is_active', 'tags', 'short_description'];

/** Neutralise spreadsheet formula injection in exported text cells. */
function safeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function toCsv(columns, rows) {
  return stringify(rows.map((r) => columns.map((c) => safeCell(r[c]))), { header: true, columns });
}

function parseCsv(buffer) {
  return parse(buffer, { columns: (h) => h.map((c) => String(c).trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

module.exports = { PRODUCT_COLUMNS, toCsv, parseCsv, parseBool, safeCell };
