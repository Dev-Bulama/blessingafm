'use strict';

/** Format integer cents as a CAD price string, e.g. 1299 -> "$12.99". */
function formatMoney(cents) {
  const n = Number(cents || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse a user-entered dollar amount ("12.5", "$1,200.00") to integer cents. Returns null when invalid. */
function parseMoney(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Cents to a plain decimal string for form inputs, e.g. 1299 -> "12.99". */
function centsToInput(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  return (Number(cents) / 100).toFixed(2);
}

module.exports = { formatMoney, parseMoney, centsToInput };
