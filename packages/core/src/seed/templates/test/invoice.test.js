'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInvoice } = require('../src/invoice');

test('computes subtotal, tax and total', () => {
  const t = computeInvoice([{ description: 'a', quantity: 2, unitPrice: 50 }], { taxRate: 0.2 });
  assert.deepEqual(t, { subtotal: 100, discount: 0, tax: 20, total: 120 });
});

test('rounds tax to the nearest cent', () => {
  const t = computeInvoice([{ description: 'hosting', quantity: 1, unitPrice: 19.99 }], { taxRate: 0.2 });
  assert.equal(t.tax, 4);
  assert.equal(t.total, 23.99);
});

test('applies a discount before tax', () => {
  const t = computeInvoice([{ description: 'a', quantity: 1, unitPrice: 200 }], { taxRate: 0.1, discount: 0.25 });
  assert.equal(t.discount, 50);
  assert.equal(t.tax, 15);
  assert.equal(t.total, 165);
});
