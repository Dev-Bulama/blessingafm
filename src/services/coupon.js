'use strict';
const { formatMoney } = require('../lib/money');

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Pure coupon evaluation.
 * @returns {{valid:boolean, discount_cents:number, reason?:string}}
 */
function evaluateCoupon(coupon, subtotalCents, now = new Date()) {
  const fail = (reason) => ({ valid: false, discount_cents: 0, reason });
  if (!coupon || !coupon.is_active) return fail('This coupon code is not valid.');
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return fail('This coupon is not active yet.');
  if (coupon.expires_at && new Date(coupon.expires_at) < now) return fail('This coupon has expired.');
  if (coupon.usage_limit !== null && coupon.usage_limit !== undefined && coupon.used_count >= coupon.usage_limit) {
    return fail('This coupon has reached its usage limit.');
  }
  if (subtotalCents < (coupon.min_spend_cents || 0)) {
    return fail(`Spend at least ${formatMoney(coupon.min_spend_cents)} to use this coupon.`);
  }
  let discount = 0;
  if (coupon.type === 'percent') {
    const pct = Math.max(0, Math.min(100, coupon.value));
    discount = Math.round((subtotalCents * pct) / 100);
  } else {
    discount = coupon.value;
  }
  discount = Math.max(0, Math.min(discount, subtotalCents));
  if (discount === 0) return fail('This coupon does not apply to your cart.');
  return { valid: true, discount_cents: discount };
}

function describeCoupon(coupon) {
  return coupon.type === 'percent' ? `${coupon.value}% off` : `${formatMoney(coupon.value)} off`;
}

module.exports = { normalizeCode, evaluateCoupon, describeCoupon };
