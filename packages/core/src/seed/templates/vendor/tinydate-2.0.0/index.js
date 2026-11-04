'use strict';

// tinydate 2.0.0
// BREAKING: `parse` was renamed to `parseDate`. Fixes TINYDATE-2026-0001 (ReDoS).
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(str) {
  const m = ISO.exec(String(str));
  if (!m) throw new Error(`tinydate: invalid date "${str}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function format(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = { parseDate, addDays, format };
