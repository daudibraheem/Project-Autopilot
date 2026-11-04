'use strict';

// Creates local config for invoice-calc. Renamed from scripts/init.js in v1.3.0.
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '.data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ currency: 'EUR', taxRate: 0.2 }, null, 2));
console.log('Bootstrap complete: .data/config.json written');
