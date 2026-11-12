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
