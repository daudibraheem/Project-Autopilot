'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dueDate } = require('../src/due');

test('due date is 30 days after issue by default', () => {
  assert.equal(dueDate('2026-01-15'), '2026-02-14');
});

test('supports custom payment terms', () => {
  assert.equal(dueDate('2026-03-01', 14), '2026-03-15');
});
