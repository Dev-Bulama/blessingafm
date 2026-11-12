'use strict';

const TZ = 'America/Toronto';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '';
}

function formatDateTime(value) {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : '';
}

/** Store-local (Toronto) calendar date as YYYY-MM-DD. */
function storeDate(value = new Date()) {
  return isoFmt.format(toDate(value));
}

/** Add days to a YYYY-MM-DD string. */
function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(ymd) {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** "2026-03-14" -> "Sat, Mar 14" (no timezone shifting). */
function formatYmd(ymd, long = false) {
  if (!ymd) return '';
  const s = ymd instanceof Date ? ymd.toISOString().slice(0, 10) : String(ymd).slice(0, 10);
  const d = new Date(`${s}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', weekday: long ? 'long' : 'short', month: long ? 'long' : 'short', day: 'numeric', year: long ? 'numeric' : undefined,
  }).format(d);
}

/** "14:30:00" -> "2:30 PM" */
function formatTime(hms) {
  if (!hms) return '';
  const [h, m] = String(hms).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Current store-local time as HH:MM:SS. */
function storeTime(value = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(value);
}

/** Convert a store-local (Toronto) date and time to a UTC Date. */
function zonedToUtc(ymd, hms = '00:00:00') {
  const guess = new Date(`${ymd}T${hms}Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(guess).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const asLocal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

module.exports = { TZ, zonedToUtc, DAY_NAMES, formatDate, formatDateTime, storeDate, storeTime, addDays, dayOfWeek, formatYmd, formatTime };
