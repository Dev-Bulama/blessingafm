'use strict';
const { formatMoney } = require('../lib/money');

const POSTAL_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;
const PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
  QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

/** "l3y 2p3" -> "L3Y2P3" */
function normalizePostal(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidPostal(input) {
  return POSTAL_RE.test(normalizePostal(input));
}

/** "L3Y2P3" -> "L3Y 2P3" */
function formatPostal(input) {
  const p = normalizePostal(input);
  return p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p;
}

function zonePrefixes(zone) {
  return String(zone.postal_prefixes || '').split(/[,\s]+/).map(normalizePostal).filter(Boolean);
}

/** Find the delivery zone for a postal code. The longest matching prefix wins. */
function matchZone(zones, postalCode) {
  const postal = normalizePostal(postalCode);
  if (!postal) return null;
  let best = null;
  let bestLen = 0;
  for (const zone of zones) {
    if (!zone.is_active) continue;
    for (const prefix of zonePrefixes(zone)) {
      if (postal.startsWith(prefix) && prefix.length > bestLen) {
        best = zone;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/**
 * Local delivery fee for a zone. `amountCents` is the order value after discounts.
 * @returns {{ok:boolean, fee_cents:number, reason?:string, free?:boolean}}
 */
function deliveryQuote(zone, amountCents) {
  if (!zone) return { ok: false, fee_cents: 0, reason: 'Sorry, we do not deliver to that postal code yet. Choose pickup or shipping instead.' };
  if (amountCents < (zone.min_order_cents || 0)) {
    return {
      ok: false,
      fee_cents: 0,
      reason: `The minimum order for delivery to ${zone.name} is ${formatMoney(zone.min_order_cents)}. Add ${formatMoney(zone.min_order_cents - amountCents)} more to your cart.`,
    };
  }
  const threshold = zone.free_threshold_cents;
  if (threshold !== null && threshold !== undefined && amountCents >= threshold) {
    return { ok: true, fee_cents: 0, free: true };
  }
  return { ok: true, fee_cents: zone.fee_cents };
}

function cartWeight(items) {
  return items.reduce((sum, i) => sum + (i.weight_grams || 0) * i.qty, 0);
}

/**
 * Flat shipping rate by weight band.
 * @returns {{ok:boolean, rate_cents:number, name?:string, reason?:string}}
 */
function shippingQuote(rates, weightGrams) {
  const active = rates.filter((r) => r.is_active).sort((a, b) => a.min_weight_grams - b.min_weight_grams);
  const band = active.find((r) => weightGrams >= r.min_weight_grams && weightGrams <= r.max_weight_grams);
  if (!band) {
    return { ok: false, rate_cents: 0, reason: 'This order is too heavy to ship at our flat rates. Please contact the store for a quote, or choose pickup or local delivery.' };
  }
  return { ok: true, rate_cents: band.rate_cents, name: band.name };
}

/** Items that cannot be shipped Canada-wide, each with the reason shown to the customer. */
function shippingBlockers(items) {
  const blockers = [];
  for (const item of items) {
    const reasons = [];
    if (item.is_frozen) reasons.push('frozen');
    if (item.is_perishable) reasons.push('perishable');
    if (item.pickup_only) reasons.push('pickup only');
    if (reasons.length) blockers.push({ name: item.variant_name ? `${item.name} (${item.variant_name})` : item.name, reasons });
  }
  return blockers;
}

/** Pickup-only items also cannot go out on local delivery. */
function deliveryBlockers(items) {
  return items
    .filter((i) => i.pickup_only)
    .map((i) => ({ name: i.variant_name ? `${i.name} (${i.variant_name})` : i.name, reasons: ['pickup only'] }));
}

module.exports = {
  PROVINCES, normalizePostal, isValidPostal, formatPostal, zonePrefixes, matchZone, deliveryQuote, cartWeight,
  shippingQuote, shippingBlockers, deliveryBlockers,
};
