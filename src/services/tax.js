'use strict';

/**
 * Tax maths. All amounts are integer cents; rates are basis points (1300 = 13% Ontario HST).
 * Only products flagged is_taxable attract tax (basic groceries are zero-rated).
 */

/** "13" or "13.5" (percent, as stored in settings) -> basis points. */
function rateToBps(ratePercent) {
  const n = Number(ratePercent);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function bpsToPercentLabel(bps) {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, '')}%`;
}

/** Tax on a base amount, rounded half-up to the nearest cent. */
function taxOn(baseCents, rateBps) {
  if (baseCents <= 0 || rateBps <= 0) return 0;
  return Math.round((baseCents * rateBps) / 10000);
}

/**
 * Portion of a delivery/shipping fee that is taxable. A delivery charge follows the tax status
 * of the goods delivered, so it is taxed in proportion to the taxable share of the order.
 */
function taxableShippingPortion(shippingCents, taxableNetCents, totalNetCents) {
  if (shippingCents <= 0 || taxableNetCents <= 0 || totalNetCents <= 0) return 0;
  return Math.round((shippingCents * taxableNetCents) / totalNetCents);
}

module.exports = { rateToBps, bpsToPercentLabel, taxOn, taxableShippingPortion };
