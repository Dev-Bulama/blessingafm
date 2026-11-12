'use strict';
const crypto = require('crypto');
const db = require('../config/db');
const Content = require('../models/content');
const Mail = require('../services/mail');
const logger = require('../config/logger');
const { z, trimmed, email, optionalText } = require('../middleware/validation');
const { stripTags, truncate } = require('../lib/html');

/** GET /:slug - CMS pages (about, shipping-delivery, returns-refunds, privacy-policy, terms...) */
async function page(req, res, next) {
  if (!/^[a-z0-9-]{1,140}$/.test(req.params.slug)) return next();
  const p = await Content.pageBySlug(req.params.slug);
  if (!p || p.slug === 'contact') return next();
  return res.render('store/page', {
    title: p.meta_title || p.title,
    metaDescription: p.meta_description || truncate(stripTags(p.body_html), 160),
    page: p,
  });
}

/** GET /faq */
async function faq(req, res) {
  const faqs = await Content.activeFaqs();
  res.locals.jsonLdBlocks.push({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  });
  res.render('store/faq', {
    title: 'Frequently Asked Questions',
    metaDescription: `Answers to common questions about ordering, pickup, delivery, shipping, payment and returns at ${res.locals.settings.store_name}.`,
    faqs,
  });
}

/** GET /contact */
async function contact(req, res) {
  const p = await Content.pageBySlug('contact');
  res.render('store/contact', {
    title: (p && (p.meta_title || p.title)) || 'Contact Us',
    metaDescription: p ? p.meta_description : null,
    page: p,
  });
}

const contactSchema = z.object({
  name: trimmed(120, 'Your name'),
  email,
  phone: optionalText(30),
  subject: optionalText(190),
  message: z.string({ error: 'Message is required' }).trim().min(10, 'Please write at least a sentence').max(5000),
  website: z.string().max(0).optional(), // honeypot: real visitors leave it empty
});

/** POST /contact - saves the message and emails the store */
async function sendContact(req, res) {
  const { website, ...data } = req.valid;
  const [id] = await db('contact_messages').insert(data);
  Mail.sendContactMessage({ id, ...data }).catch((err) => logger.error('contact email failed', err));
  req.flash('success', 'Thank you - your message has been sent. We will get back to you shortly.');
  res.redirect('/contact');
}

const newsletterSchema = z.object({ email, source: z.string().max(40).optional() });

/** POST /newsletter/subscribe */
async function subscribe(req, res) {
  const existing = await db('newsletter_subscribers').where({ email: req.valid.email }).first();
  if (existing) {
    if (!existing.is_subscribed) await db('newsletter_subscribers').where({ id: existing.id }).update({ is_subscribed: true });
  } else {
    await db('newsletter_subscribers').insert({
      email: req.valid.email, source: req.valid.source || 'website', unsubscribe_token: crypto.randomBytes(20).toString('hex'),
    });
  }
  const message = 'You are subscribed. Watch your inbox for deals and new arrivals!';
  if (req.xhr) return res.json({ ok: true, message });
  req.flash('success', message);
  return res.redirect(req.get('referer') && new URL(req.get('referer'), 'http://x').pathname || '/');
}

/** GET /newsletter/unsubscribe/:token */
async function unsubscribe(req, res) {
  if (/^[a-f0-9]{40}$/.test(req.params.token)) {
    await db('newsletter_subscribers').where({ unsubscribe_token: req.params.token }).update({ is_subscribed: false });
  }
  res.render('store/message', {
    title: 'Unsubscribed', noindex: true, heading: 'You have been unsubscribed',
    text: 'You will no longer receive our newsletter. You can subscribe again at any time from the bottom of any page.',
  });
}

/** GET /email/unsubscribe/:id/:sig - one-click opt-out from reminder emails (signed link, no login needed) */
async function unsubscribeReminders(req, res) {
  const id = Number(req.params.id) || 0;
  if (id && Mail.verifyUnsubscribe(id, req.params.sig)) await db('users').where({ id }).update({ marketing_opt_out: true });
  res.render('store/message', {
    title: 'Email preferences updated', noindex: true, heading: 'You will not get reminder emails',
    text: 'We have turned off cart reminders and review requests for your account. You will still receive emails about your orders.',
  });
}

module.exports = { unsubscribeReminders, page, faq, contact, contactSchema, sendContact, newsletterSchema, subscribe, unsubscribe };
