'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/services/shipping');

const zones = [
  { id: 1, name: 'Newmarket', postal_prefixes: 'L3Y, L3X', fee_cents: 500, min_order_cents: 3000, free_threshold_cents: 7500, is_active: true },
  { id: 2, name: 'Aurora', postal_prefixes: 'L4G', fee_cents: 800, min_order_cents: 4000, free_threshold_cents: null, is_active: true },
  { id: 3, name: 'Davis Drive block', postal_prefixes: 'L3Y2', fee_cents: 200, min_order_cents: 0, free_threshold_cents: null, is_active: true },
  { id: 4, name: 'Disabled', postal_prefixes: 'M5V', fee_cents: 100, min_order_cents: 0, free_threshold_cents: null, is_active: false },
];

test('postal code helpers', () => {
  assert.equal(s.normalizePostal('l3y 2p3'), 'L3Y2P3');
  assert.equal(s.formatPostal('l3y2p3'), 'L3Y 2P3');
  assert.equal(s.isValidPostal('L3Y 2P3'), true);
  assert.equal(s.isValidPostal('12345'), false);
  assert.equal(s.isValidPostal('D3Y 2P3'), false);
});

test('zone matching by prefix, longest prefix wins', () => {
  assert.equal(s.matchZone(zones, 'L3X 1A1').id, 1);
  assert.equal(s.matchZone(zones, 'l4g1a1').id, 2);
  assert.equal(s.matchZone(zones, 'L3Y 2P3').id, 3);
  assert.equal(s.matchZone(zones, 'M5V 1A1'), null); // inactive zone
  assert.equal(s.matchZone(zones, 'K1A 0B1'), null);
  assert.equal(s.matchZone(zones, ''), null);
});

test('delivery fee, minimum order and free threshold', () => {
  assert.deepEqual(s.deliveryQuote(zones[0], 5000), { ok: true, fee_cents: 500 });
  assert.deepEqual(s.deliveryQuote(zones[0], 7500), { ok: true, fee_cents: 0, free: true });
  const low = s.deliveryQuote(zones[0], 2500);
  assert.equal(low.ok, false);
  assert.match(low.reason, /\$30\.00/);
  assert.match(low.reason, /\$5\.00 more/);
  assert.equal(s.deliveryQuote(zones[1], 99999).fee_cents, 800); // no free threshold
  assert.equal(s.deliveryQuote(null, 5000).ok, false);
});

const rates = [
  { name: 'Up to 2 kg', min_weight_grams: 0, max_weight_grams: 2000, rate_cents: 1499, is_active: true },
  { name: '2 to 5 kg', min_weight_grams: 2001, max_weight_grams: 5000, rate_cents: 1999, is_active: true },
  { name: 'Old', min_weight_grams: 5001, max_weight_grams: 10000, rate_cents: 100, is_active: false },
];

test('shipping weight bands', () => {
  assert.equal(s.cartWeight([{ weight_grams: 500, qty: 3 }, { weight_grams: 250, qty: 2 }]), 2000);
  assert.equal(s.shippingQuote(rates, 0).rate_cents, 1499);
  assert.equal(s.shippingQuote(rates, 2000).rate_cents, 1499);
  assert.equal(s.shippingQuote(rates, 2001).rate_cents, 1999);
  assert.equal(s.shippingQuote(rates, 6000).ok, false); // only an inactive band covers it
});

test('shipping and delivery blockers name the offending items', () => {
  const items = [
    { name: 'Garri', qty: 1 },
    { name: 'Frozen Tilapia', is_frozen: true, is_perishable: true, qty: 1 },
    { name: 'Fresh Plantain', is_perishable: true, qty: 1 },
    { name: 'Rice 20 kg', variant_name: 'Bag', pickup_only: true, qty: 1 },
  ];
  const b = s.shippingBlockers(items);
  assert.equal(b.length, 3);
  assert.deepEqual(b[0], { name: 'Frozen Tilapia', reasons: ['frozen', 'perishable'] });
  assert.deepEqual(b[2], { name: 'Rice 20 kg (Bag)', reasons: ['pickup only'] });
  assert.deepEqual(s.deliveryBlockers(items).map((x) => x.name), ['Rice 20 kg (Bag)']);
  assert.deepEqual(s.shippingBlockers([items[0]]), []);
});
