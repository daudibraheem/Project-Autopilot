'use strict';

const { parse, addDays, format } = require('tinydate');

/** Due date for an invoice issued on `issued` (YYYY-MM-DD) with net `termsDays`. */
function dueDate(issued, termsDays = 30) {
  return format(addDays(parse(issued), termsDays));
}

module.exports = { dueDate };
