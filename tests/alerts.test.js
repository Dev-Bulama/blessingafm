'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crossedLowStock } = require('../src/services/inventory');
const paypal = require('../src/services/paypal');

test('low-stock alert fires only when an item crosses its threshold', () => {
  assert.equal(crossedLowStock(6, 5, 5), true); // reaches the threshold
  assert.equal(crossedLowStock(8, 2, 5), true); // jumps past it
  assert.equal(crossedLowStock(5, 4, 5), false); // already low: no repeat alert
  assert.equal(crossedLowStock(10, 6, 5), false); // still above
  assert.equal(crossedLowStock(1, 0, 5), false); // already low
  assert.equal(crossedLowStock(3, 0, 0), true); // threshold 0 = alert when sold out
  assert.equal(crossedLowStock(4, 9, 5), false); // stock went up
});

test('placeholder payment keys count as not configured', () => {
  const { isRealKey } = require('../src/config/stripe');
  // Key-shaped strings are assembled here so the file never contains anything that looks like a credential.
  const body = 'A1b2C3d4'.repeat(3);
  const make = (prefix, mode) => [prefix, mode, body].join('_');
  for (const bad of ['', 'test', ['sk', 'test', 'xxx'].join('_'), ['sk', 'test', ''].join('_'), make('pk', 'test'), 'whsec_abc']) assert.equal(isRealKey(bad), false, bad);
  assert.equal(isRealKey(make('sk', 'test')), true);
  assert.equal(isRealKey(make('sk', 'live')), true);
  assert.equal(isRealKey(make('rk', 'live')), true);
});

test('PayPal amounts convert to and from cents exactly', () => {
  assert.equal(paypal.toAmount(4670), '46.70');
  assert.equal(paypal.toAmount(5), '0.05');
  assert.equal(paypal.toCents('46.70'), 4670);
  assert.equal(paypal.toCents('0.07'), 7);
  assert.equal(paypal.toCents('19.99'), 1999);
  assert.equal(paypal.toCents('12.3'), 1230);
  assert.equal(paypal.toCents('100'), 10000);
  for (const cents of [1, 99, 100, 1999, 4670, 123456]) assert.equal(paypal.toCents(paypal.toAmount(cents)), cents);
});
