'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCoupon, normalizeCode, describeCoupon } = require('../src/services/coupon');

const base = { is_active: true, type: 'percent', value: 10, min_spend_cents: 0, starts_at: null, expires_at: null, usage_limit: null, used_count: 0 };
const now = new Date('2026-06-01T12:00:00Z');

test('percent coupon', () => {
  assert.deepEqual(evaluateCoupon(base, 5000, now), { valid: true, discount_cents: 500 });
  assert.equal(evaluateCoupon({ ...base, value: 15 }, 999, now).discount_cents, 150);
});

test('fixed coupon is capped at the subtotal', () => {
  const c = { ...base, type: 'fixed', value: 1000 };
  assert.equal(evaluateCoupon(c, 5000, now).discount_cents, 1000);
  assert.equal(evaluateCoupon(c, 600, now).discount_cents, 600);
});

test('minimum spend', () => {
  const r = evaluateCoupon({ ...base, min_spend_cents: 5000 }, 4999, now);
  assert.equal(r.valid, false);
  assert.match(r.reason, /\$50\.00/);
  assert.equal(evaluateCoupon({ ...base, min_spend_cents: 5000 }, 5000, now).valid, true);
});

test('expiry and start dates', () => {
  assert.equal(evaluateCoupon({ ...base, expires_at: '2026-05-31T00:00:00Z' }, 5000, now).valid, false);
  assert.equal(evaluateCoupon({ ...base, expires_at: '2026-06-02T00:00:00Z' }, 5000, now).valid, true);
  assert.equal(evaluateCoupon({ ...base, starts_at: '2026-07-01T00:00:00Z' }, 5000, now).valid, false);
});

test('usage limit', () => {
  assert.equal(evaluateCoupon({ ...base, usage_limit: 5, used_count: 5 }, 5000, now).valid, false);
  assert.equal(evaluateCoupon({ ...base, usage_limit: 5, used_count: 4 }, 5000, now).valid, true);
});

test('inactive, missing and empty-cart coupons', () => {
  assert.equal(evaluateCoupon(null, 5000, now).valid, false);
  assert.equal(evaluateCoupon({ ...base, is_active: false }, 5000, now).valid, false);
  assert.equal(evaluateCoupon(base, 0, now).valid, false);
});

test('helpers', () => {
  assert.equal(normalizeCode(' welcome 10 '), 'WELCOME10');
  assert.equal(describeCoupon(base), '10% off');
  assert.equal(describeCoupon({ type: 'fixed', value: 500 }), '$5.00 off');
});
