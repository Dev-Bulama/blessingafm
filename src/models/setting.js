'use strict';
const db = require('../config/db');

const TTL_MS = 30 * 1000;
let cache = null;
let cachedAt = 0;

/** All settings as a plain { key: value } object (cached briefly in memory). */
async function getAll() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await db('settings').select('key', 'value');
  const out = {};
  for (const r of rows) out[r.key] = r.value === null ? '' : r.value;
  cache = out;
  cachedAt = Date.now();
  return out;
}

async function get(key, fallback = '') {
  const all = await getAll();
  return all[key] !== undefined && all[key] !== '' ? all[key] : fallback;
}

async function setMany(values) {
  const rows = Object.entries(values).map(([key, value]) => ({
    key, value: value === null || value === undefined ? '' : String(value), updated_at: new Date(),
  }));
  if (rows.length) await db('settings').insert(rows).onConflict('key').merge(['value', 'updated_at']);
  invalidate();
}

function invalidate() {
  cache = null;
}

const isOn = (settings, key) => settings[key] === '1' || settings[key] === 'true';

module.exports = { getAll, get, setMany, invalidate, isOn };
