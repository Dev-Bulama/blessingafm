'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocate, computeTotals, percentOff } = require('../src/services/pricing');
const tax = require('../src/services/tax');
const { formatMoney, parseMoney, centsToInput } = require('../src/lib/money');

test('allocate splits exactly and proportionally', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(1000, [3000, 1000]), [750, 250]);
  assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
  assert.deepEqual(allocate(7, [0, 10]), [0, 7]);
  const parts = allocate(999, [333, 127, 541, 2]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 999);
});

test('tax helpers', () => {
  assert.equal(tax.rateToBps('13'), 1300);
  assert.equal(tax.rateToBps('13.5'), 1350);
  assert.equal(tax.rateToBps('abc'), 0);
  assert.equal(tax.taxOn(1000, 1300), 130);
  assert.equal(tax.taxOn(999, 1300), 130); // 129.87 rounds up
  assert.equal(tax.taxOn(0, 1300), 0);
  assert.equal(tax.bpsToPercentLabel(1300), '13%');
  assert.equal(tax.taxableShippingPortion(1000, 500, 2000), 250);
  assert.equal(tax.taxableShippingPortion(1000, 0, 2000), 0);
});

test('HST applies only to taxable products', () => {
  const t = computeTotals({
    lines: [
      { unit_price_cents: 1299, qty: 2, is_taxable: false }, // garri, zero-rated
      { unit_price_cents: 899, qty: 1, is_taxable: true }, // shea butter
    ],
    taxRateBps: 1300,
  });
  assert.equal(t.subtotal_cents, 3497);
  assert.equal(t.tax_cents, 117); // 13% of 8.99 = 1.1687
  assert.equal(t.total_cents, 3614);
  assert.equal(t.lines[0].tax_cents, 0);
  assert.equal(t.lines[1].tax_cents, 117);
  assert.equal(t.lines[1].line_total_cents, 1016);
});

test('zero-rated only cart has no tax, even with a delivery fee', () => {
  const t = computeTotals({
    lines: [{ unit_price_cents: 2000, qty: 1, is_taxable: false }],
    shippingCents: 799,
    taxRateBps: 1300,
  });
  assert.equal(t.tax_cents, 0);
  assert.equal(t.total_cents, 2799);
});

test('delivery fee is taxed in proportion to taxable goods', () => {
  const t = computeTotals({
    lines: [
      { unit_price_cents: 1000, qty: 1, is_taxable: true },
      { unit_price_cents: 1000, qty: 1, is_taxable: false },
    ],
    shippingCents: 1000,
    taxRateBps: 1300,
  });
  assert.equal(t.items_tax_cents, 130);
  assert.equal(t.shipping_tax_cents, 65); // half of the fee is taxable
  assert.equal(t.tax_cents, 195);
  assert.equal(t.total_cents, 2000 + 1000 + 195);
});

test('taxShipping=false leaves the fee untaxed', () => {
  const t = computeTotals({
    lines: [{ unit_price_cents: 1000, qty: 1, is_taxable: true }],
    shippingCents: 1000,
    taxRateBps: 1300,
    taxShipping: false,
  });
  assert.equal(t.tax_cents, 130);
});

test('coupon discount reduces the taxable base and is spread across lines', () => {
  const t = computeTotals({
    lines: [
      { unit_price_cents: 3000, qty: 1, is_taxable: true },
      { unit_price_cents: 1000, qty: 1, is_taxable: false },
    ],
    discountCents: 400,
    taxRateBps: 1300,
  });
  assert.equal(t.discount_cents, 400);
  assert.equal(t.lines[0].discount_cents, 300);
  assert.equal(t.lines[1].discount_cents, 100);
  assert.equal(t.tax_cents, 351); // 13% of 27.00
  assert.equal(t.total_cents, 4000 - 400 + 351);
  const lineSum = t.lines.reduce((a, l) => a + l.line_total_cents, 0);
  assert.equal(lineSum, t.total_cents);
});

test('discount can never exceed the subtotal', () => {
  const t = computeTotals({
    lines: [{ unit_price_cents: 500, qty: 1, is_taxable: true }],
    discountCents: 9999,
    taxRateBps: 1300,
  });
  assert.equal(t.discount_cents, 500);
  assert.equal(t.tax_cents, 0);
  assert.equal(t.total_cents, 0);
});

test('line taxes always sum to the items tax', () => {
  const t = computeTotals({
    lines: [
      { unit_price_cents: 333, qty: 1, is_taxable: true },
      { unit_price_cents: 333, qty: 1, is_taxable: true },
      { unit_price_cents: 333, qty: 1, is_taxable: true },
    ],
    taxRateBps: 1300,
  });
  assert.equal(t.items_tax_cents, 130); // 13% of 9.99
  assert.equal(t.lines.reduce((a, l) => a + l.tax_cents, 0), 130);
});

test('empty cart', () => {
  const t = computeTotals({ lines: [], taxRateBps: 1300 });
  assert.equal(t.total_cents, 0);
});

test('percentOff', () => {
  assert.equal(percentOff(800, 1000), 20);
  assert.equal(percentOff(1000, 1000), 0);
  assert.equal(percentOff(1000, null), 0);
});

test('money helpers', () => {
  assert.equal(formatMoney(1299), '$12.99');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(123456789), '$1,234,567.89');
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('$1,200.00'), 120000);
  assert.equal(parseMoney('0.07'), 7);
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.234'), null);
  assert.equal(parseMoney('-5'), null);
  assert.equal(centsToInput(1250), '12.50');
});
