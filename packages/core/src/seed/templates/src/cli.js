'use strict';

const { computeInvoice } = require('./invoice');
const { dueDate } = require('./due');

const sample = [
  { description: 'Design work', quantity: 3, unitPrice: 120 },
  { description: 'Hosting', quantity: 1, unitPrice: 19.99 },
];

if (process.argv.includes('--sample')) {
  const totals = computeInvoice(sample, { taxRate: 0.2 });
  console.log(`Invoice INV-0042 · due ${dueDate('2026-01-15', 30)}`);
  console.log(`Subtotal ${totals.subtotal.toFixed(2)}  Tax ${totals.tax.toFixed(2)}  Total ${totals.total.toFixed(2)}`);
} else {
  console.log('usage: node src/cli.js --sample');
}
