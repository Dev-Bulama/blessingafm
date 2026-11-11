'use strict';
const tax = require('./tax');

/**
 * Split `total` cents across `weights` proportionally using the largest-remainder method,
 * so the parts always sum exactly to `total`.
 */
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    if (weights[order[k].i] > 0) {
      parts[order[k].i] += 1;
      remainder -= 1;
    }
  }
  return parts;
}

/**
 * Compute every money figure for a cart/order.
 *
 * @param {object} input
 * @param {Array<{unit_price_cents:number, qty:number, is_taxable:boolean}>} input.lines
 * @param {number} [input.discountCents]  coupon discount (capped at the subtotal)
 * @param {number} [input.shippingCents]  delivery or shipping fee
 * @param {number} input.taxRateBps       e.g. 1300 for 13% HST
 * @param {boolean} [input.taxShipping]   tax the fee in proportion to the taxable goods
 */
function computeTotals({ lines, discountCents = 0, shippingCents = 0, taxRateBps = 0, taxShipping = true }) {
  const subtotals = lines.map((l) => l.unit_price_cents * l.qty);
  const subtotal = subtotals.reduce((a, b) => a + b, 0);
  const discount = Math.max(0, Math.min(discountCents, subtotal));
  const discounts = allocate(discount, subtotals);
  const nets = subtotals.map((s, i) => s - discounts[i]);

  const taxableNets = nets.map((n, i) => (lines[i].is_taxable ? n : 0));
  const taxableNet = taxableNets.reduce((a, b) => a + b, 0);
  const totalNet = subtotal - discount;

  const itemsTax = tax.taxOn(taxableNet, taxRateBps);
  const taxableShipping = taxShipping ? tax.taxableShippingPortion(shippingCents, taxableNet, totalNet) : 0;
  const shippingTax = tax.taxOn(taxableShipping, taxRateBps);
  const lineTaxes = allocate(itemsTax, taxableNets);

  const outLines = lines.map((l, i) => ({
    ...l,
    line_subtotal_cents: subtotals[i],
    discount_cents: discounts[i],
    tax_cents: lineTaxes[i],
    line_total_cents: nets[i] + lineTaxes[i],
  }));

  const taxTotal = itemsTax + shippingTax;
  return {
    lines: outLines,
    subtotal_cents: subtotal,
    discount_cents: discount,
    shipping_cents: shippingCents,
    taxable_cents: taxableNet + taxableShipping,
    items_tax_cents: itemsTax,
    shipping_tax_cents: shippingTax,
    tax_cents: taxTotal,
    total_cents: totalNet + shippingCents + taxTotal,
    tax_rate_bps: taxRateBps,
  };
}

/** Sale percentage for badges, e.g. compare 1000 / price 800 -> 20. */
function percentOff(priceCents, compareAtCents) {
  if (!compareAtCents || compareAtCents <= priceCents) return 0;
  return Math.round(((compareAtCents - priceCents) / compareAtCents) * 100);
}

module.exports = { allocate, computeTotals, percentOff };
