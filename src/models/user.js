'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const BCRYPT_ROUNDS = 12;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const findById = (id) => db('users').where({ id }).first();
const findByEmail = (email) => db('users').where({ email: normalizeEmail(email) }).first();
const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

async function create({ email, password, first_name, last_name, phone = null, role = 'customer', verified = false }) {
  const [id] = await db('users').insert({
    email: normalizeEmail(email),
    password_hash: await hashPassword(password),
    first_name,
    last_name,
    phone,
    role,
    email_verified_at: verified ? new Date() : null,
  });
  return findById(id);
}

async function setPassword(userId, password) {
  await db('users').where({ id: userId }).update({ password_hash: await hashPassword(password) });
}

/** Create a one-time token; only its SHA-256 hash is stored. Returns the raw token for the email link. */
async function createToken(userId, type, ttlMinutes) {
  const raw = crypto.randomBytes(32).toString('hex');
  await db('user_tokens').where({ user_id: userId, type }).whereNull('used_at').del();
  await db('user_tokens').insert({
    user_id: userId, type, token_hash: sha256(raw), expires_at: new Date(Date.now() + ttlMinutes * 60000),
  });
  return raw;
}

/** Look up a valid (unused, unexpired) token. */
async function findToken(raw, type) {
  if (!/^[a-f0-9]{64}$/.test(String(raw || ''))) return null;
  return db('user_tokens').where({ token_hash: sha256(raw), type }).whereNull('used_at')
    .where('expires_at', '>', new Date()).first();
}

const consumeToken = (id) => db('user_tokens').where({ id }).update({ used_at: new Date() });

module.exports = {
  normalizeEmail, findById, findByEmail, hashPassword, verifyPassword, create, setPassword, createToken, findToken,
  consumeToken,
};
