'use strict';

const RATES = { EUR: 1, USD: 1.08, GBP: 0.85 };

/** Deterministic PRNG so CI runs can be replayed with FLAKY_SEED. */
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulated latency of the exchange-rate service, in ms. */
function rateServiceLatency() {
  const seed = process.env.FLAKY_SEED;
  const r = seed ? rng(seed)() : Math.random();
  return Math.round(20 + r * 100);
}

/** Convert an amount from EUR. Throws if the (simulated) rate service is too slow. */
function convert(amountEur, currency, deadlineMs = 100) {
  const latency = rateServiceLatency();
  if (latency > deadlineMs) {
    throw new Error(`rate service timed out after ${latency}ms (deadline ${deadlineMs}ms)`);
  }
  const rate = RATES[currency];
  if (rate === undefined) throw new Error(`unknown currency ${currency}`);
  return Math.round(amountEur * rate * 100) / 100;
}

module.exports = { convert, rateServiceLatency };
