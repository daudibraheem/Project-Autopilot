'use strict';

// Minimal offline linter: syntax-check JS files, parse JSON files.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : walk('src').concat(walk('test'), walk('scripts'), ['package.json']);
let failed = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  try {
    if (f.endsWith('.js')) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    else if (f.endsWith('.json')) JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    failed++;
    console.error(`lint: ${f}: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`);
  }
}
console.log(failed ? `lint: ${failed} problem(s)` : `lint: ${files.length} file(s) clean`);
process.exit(failed ? 1 : 0);
