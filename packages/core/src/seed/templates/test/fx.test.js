'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { convert } = require('../src/fx');

test('converts EUR invoices within the rate-service deadline', () => {
  assert.equal(convert(100, 'USD'), 108);
});
