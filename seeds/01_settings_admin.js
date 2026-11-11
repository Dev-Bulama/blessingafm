'use strict';
const bcrypt = require('bcryptjs');

/**
 * Default settings and the first admin user.
 * Safe to re-run: existing settings and users are never overwritten.
 * Values marked [PLACEHOLDER] must be replaced in Admin > Settings before going live.
 */
const DEFAULTS = {
  store_name: 'Blessing African Market & Beauty Store',
  store_tagline: 'African groceries and beauty, all in one place',
  store_address_line1: '77 Davis Drive',
  store_city: 'Newmarket',
  store_province: 'ON',
  store_postal_code: '[PLACEHOLDER POSTAL CODE]',
  store_country: 'Canada',
  store_phone: '[PLACEHOLDER] (905) 555-0100',
  store_email: 'placeholder@example.com',
  store_whatsapp: '',
  store_hours: 'Monday to Saturday: 10:00 AM - 8:00 PM [PLACEHOLDER]\nSunday: 12:00 PM - 6:00 PM [PLACEHOLDER]',
  social_facebook: '',
  social_instagram: '',
  social_tiktok: '',
  logo_path: '',
  meta_description: 'African and Caribbean groceries and beauty products in Newmarket, Ontario. Shop garri, pounded yam, palm oil, frozen fish, braiding hair, wigs, shea butter and more. Pickup, local delivery and Canada-wide shipping.',
  announcement_enabled: '1',
  announcement_text: 'Now open at 77 Davis Drive, Newmarket! Free in-store pickup on every order.',
  tax_rate: '13',
  tax_label: 'HST',
  tax_shipping: '1',
  pickup_enabled: '1',
  delivery_enabled: '1',
  shipping_enabled: '1',
  pickup_days_ahead: '7',
  pickup_lead_minutes: '120',
  payment_stripe_enabled: '1',
  payment_etransfer_enabled: '1',
  payment_instore_enabled: '1',
  etransfer_email: 'placeholder@example.com',
  etransfer_instructions: 'Send an Interac e-Transfer for the order total to the email address above and put your order number in the message. We will start preparing your order as soon as the transfer is accepted. Orders not paid within 48 hours may be cancelled.',
  order_notify_email: '',
};

exports.seed = async function seed(knex) {
  const rows = Object.entries(DEFAULTS).map(([key, value]) => ({ key, value }));
  await knex('settings').insert(rows).onConflict('key').ignore();

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment before running the seed.');
  }
  if (password.length < 10 || password.startsWith('change-me')) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters and not the example value.');
  }
  const existing = await knex('users').where({ email }).first('id');
  if (!existing) {
    await knex('users').insert({
      email,
      password_hash: await bcrypt.hash(password, 12),
      first_name: process.env.ADMIN_FIRST_NAME || 'Store',
      last_name: process.env.ADMIN_LAST_NAME || 'Admin',
      role: 'admin',
      email_verified_at: new Date(),
    });
    console.log(`  Created admin user ${email}`);
  } else {
    console.log(`  Admin user ${email} already exists - left unchanged`);
  }
};
