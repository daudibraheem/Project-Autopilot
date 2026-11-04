'use strict';

// tinydate 1.0.0
// NOTE: the regex below backtracks badly on crafted input (see advisory TINYDATE-2026-0001).
const ISO = /^((\d+)+)-(\d{2})-(\d{2})$/;

function parse(str) {
  const m = ISO.exec(String(str));
  if (!m) throw new Error(`tinydate: invalid date "${str}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[3]) - 1, Number(m[4])));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function format(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = { parse, addDays, format };
