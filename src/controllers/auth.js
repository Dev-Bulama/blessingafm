'use strict';
const db = require('../config/db');
const logger = require('../config/logger');
const User = require('../models/user');
const Cart = require('../services/cart');
const Mail = require('../services/mail');
const { signIn, signOut, safeNext } = require('../middleware/auth');
const { z, email, password, trimmed, optionalText } = require('../middleware/validation');

// A real bcrypt hash compared against when the account does not exist, so response time does not reveal it.
const DUMMY_HASH = '$2b$12$67H8ns7fn.kNEmpWjzyPiOHWrjhhK02j9c4k2iZsWAy/ex0jdiGaa';

const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(200), next: z.string().max(300).optional() });
const registerSchema = z.object({
  first_name: trimmed(80, 'First name'),
  last_name: trimmed(80, 'Last name'),
  email,
  phone: optionalText(30),
  password,
  password_confirm: z.string(),
  newsletter: z.string().optional(),
}).refine((d) => d.password === d.password_confirm, { path: ['password_confirm'], message: 'Passwords do not match' });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ password, password_confirm: z.string() })
  .refine((d) => d.password === d.password_confirm, { path: ['password_confirm'], message: 'Passwords do not match' });

function showLogin(req, res) {
  res.render('account/login', { title: 'Sign In', noindex: true, next: safeNext(req.query.next, '') });
}

/** POST /account/login */
async function login(req, res) {
  const { email: addr, password: pw } = req.valid;
  const user = await User.findByEmail(addr);
  const ok = await User.verifyPassword(pw, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || user.is_disabled) {
    req.session.form = { old: { email: addr, next: req.valid.next }, errors: {} };
    req.flash('error', 'Incorrect email or password.');
    return res.redirect(`/account/login${req.valid.next ? `?next=${encodeURIComponent(req.valid.next)}` : ''}`);
  }
  await signIn(req, user); // regenerates the session id
  req.user = user;
  await Cart.mergeOnLogin(req, user.id);
  await db('users').where({ id: user.id }).update({ last_login_at: new Date() });
  return res.redirect(safeNext(req.valid.next, user.role === 'customer' ? '/account' : '/admin'));
}

function showRegister(req, res) {
  res.render('account/register', { title: 'Create an Account', noindex: true });
}

/** POST /account/register */
async function register(req, res) {
  const d = req.valid;
  if (await User.findByEmail(d.email)) {
    req.session.form = { old: { ...req.body, password: undefined, password_confirm: undefined, _csrf: undefined }, errors: { email: 'An account with this email already exists. Try signing in instead.' } };
    req.flash('error', 'An account with this email already exists.');
    return res.redirect('/account/register');
  }
  const user = await User.create(d);
  if (d.newsletter) {
    await db('newsletter_subscribers').insert({
      email: user.email, source: 'register', unsubscribe_token: require('crypto').randomBytes(20).toString('hex'),
    }).onConflict('email').ignore();
  }
  const token = await User.createToken(user.id, 'verify', 60 * 48);
  Mail.sendVerifyEmail(user, token).catch((err) => logger.error('verify email failed', err));
  await signIn(req, user);
  req.user = user;
  await Cart.mergeOnLogin(req, user.id);
  req.flash('success', 'Welcome! Your account has been created. Please check your email to confirm your address.');
  return res.redirect('/account');
}

/** POST /account/logout */
async function logout(req, res) {
  await signOut(req);
  res.clearCookie('bam.sid');
  res.redirect('/');
}

/** GET /account/verify/:token */
async function verify(req, res) {
  const token = await User.findToken(req.params.token, 'verify');
  if (!token) {
    return res.status(400).render('store/message', {
      title: 'Link expired', noindex: true, heading: 'This link is no longer valid',
      text: 'The confirmation link has expired or was already used. Sign in and request a new one from your account page.',
      cta: { label: 'Go to my account', url: '/account' },
    });
  }
  const user = await User.findById(token.user_id);
  await db('users').where({ id: user.id }).whereNull('email_verified_at').update({ email_verified_at: new Date() });
  await User.consumeToken(token.id);
  // Now that the address is proven, attach earlier guest orders placed with it.
  await db('orders').whereNull('user_id').where({ email: user.email }).update({ user_id: user.id });
  req.flash('success', 'Thank you - your email address is confirmed.');
  return res.redirect(req.user ? '/account' : '/account/login');
}

/** POST /account/verify/resend */
async function resendVerification(req, res) {
  if (!req.user.email_verified_at) {
    const token = await User.createToken(req.user.id, 'verify', 60 * 48);
    await Mail.sendVerifyEmail(req.user, token);
  }
  req.flash('success', 'We have sent you a new confirmation email.');
  res.redirect('/account');
}

function showForgot(req, res) {
  res.render('account/forgot', { title: 'Forgot Password', noindex: true });
}

/** POST /account/forgot - same response whether or not the account exists */
async function forgot(req, res) {
  const user = await User.findByEmail(req.valid.email);
  if (user && !user.is_disabled) {
    const token = await User.createToken(user.id, 'reset', 60);
    Mail.sendPasswordReset(user, token).catch((err) => logger.error('reset email failed', err));
  }
  req.flash('success', 'If an account exists for that email, a password reset link is on its way. The link is valid for 60 minutes.');
  res.redirect('/account/login');
}

async function showReset(req, res) {
  const token = await User.findToken(req.params.token, 'reset');
  if (!token) {
    req.flash('error', 'That password reset link has expired or was already used. Please request a new one.');
    return res.redirect('/account/forgot');
  }
  return res.render('account/reset', { title: 'Choose a New Password', noindex: true, token: req.params.token });
}

/** POST /account/reset/:token */
async function reset(req, res) {
  const token = await User.findToken(req.params.token, 'reset');
  if (!token) {
    req.flash('error', 'That password reset link has expired or was already used. Please request a new one.');
    return res.redirect('/account/forgot');
  }
  await User.setPassword(token.user_id, req.valid.password);
  await User.consumeToken(token.id);
  // Receiving the reset email also proves ownership of the address.
  await db('users').where({ id: token.user_id }).whereNull('email_verified_at').update({ email_verified_at: new Date() });
  req.flash('success', 'Your password has been changed. You can now sign in.');
  return res.redirect('/account/login');
}

module.exports = {
  loginSchema, registerSchema, forgotSchema, resetSchema, showLogin, login, showRegister, register, logout, verify,
  resendVerification, showForgot, forgot, showReset, reset,
};
