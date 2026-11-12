'use strict';
const { z } = require('zod');

const SENSITIVE = /password|_csrf/i;

function fieldErrors(zodError) {
  const out = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Validate req.body (or query/params) against a zod schema. On success the parsed, typed data is
 * placed on req.valid. On failure HTML forms are redirected back with field errors and the old
 * input; JSON clients get a 422.
 *
 * @param {z.ZodTypeAny} schema
 * @param {{source?: 'body'|'query'|'params', back?: string|((req)=>string)}} [options]
 */
function validate(schema, { source = 'body', back = null } = {}) {
  return function validator(req, res, next) {
    const result = schema.safeParse(req[source] || {});
    if (result.success) {
      req.valid = result.data;
      return next();
    }
    const errors = fieldErrors(result.error);
    if (req.xhr || req.is('json') || !back) {
      return res.status(422).json({ ok: false, message: Object.values(errors)[0], errors });
    }
    const old = {};
    for (const [k, v] of Object.entries(req.body || {})) if (!SENSITIVE.test(k)) old[k] = v;
    req.session.form = { old, errors };
    req.flash('error', 'Please check the highlighted fields and try again.');
    return res.redirect(typeof back === 'function' ? back(req) : back);
  };
}

// ---------- Reusable field schemas ----------
const trimmed = (max, label = 'This field') => z.string({ error: `${label} is required` }).trim()
  .min(1, `${label} is required`).max(max, `${label} is too long`);
const optionalText = (max) => z.string().trim().max(max, 'Too long').optional().transform((v) => v || null);
const email = z.string({ error: 'Email is required' }).trim().toLowerCase().max(190).email('Enter a valid email address');
const phone = z.string({ error: 'Phone number is required' }).trim().min(7, 'Enter a valid phone number').max(30)
  .regex(/^[0-9+()\-.\s]+$/, 'Enter a valid phone number');
const password = z.string({ error: 'Password is required' }).min(10, 'Use at least 10 characters').max(200);
const id = z.coerce.number().int().positive();
const checkbox = z.preprocess((v) => v === 'on' || v === '1' || v === 'true' || v === true, z.boolean());
const postalCode = z.string({ error: 'Postal code is required' }).trim().toUpperCase()
  .transform((v) => v.replace(/[^A-Z0-9]/g, ''))
  .refine((v) => /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(v), 'Enter a valid Canadian postal code');
const province = z.enum(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'], { message: 'Choose a province' });

module.exports = { z, validate, fieldErrors, trimmed, optionalText, email, phone, password, id, checkbox, postalCode, province };
