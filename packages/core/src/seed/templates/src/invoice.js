'use strict';

/** Round a money amount to whole cents. */
function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

/**
 * Compute invoice totals.
 * @param {{ description: string, quantity: number, unitPrice: number }[]} lines
 * @param {{ taxRate?: number, discount?: number }} [options]
 */
function computeInvoice(lines, options = {}) {
  const taxRate = options.taxRate ?? 0.2;
  const discount = options.discount ?? 0;
  const subtotal = roundCents(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
  const discountAmount = roundCents(subtotal * discount);
  const taxable = subtotal - discountAmount;
  const tax = roundCents(taxable * taxRate);
  return { subtotal, discount: discountAmount, tax, total: roundCents(taxable + tax) };
}

module.exports = { computeInvoice, roundCents };
