'use strict';

// Inline tests for ArqueoFlow core logic.
// Run with: node test.js

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ── Test db.js ────────────────────────────────────────────────────────────────
console.log('\n── db.js ────────────────────────────────────────────────────────');

process.env.DB_PATH = ':memory:';
const { getSession, upsertSession, deleteSession } = require('./src/db');

const CHAT = 12345;

assert(getSession(CHAT) === null, 'getSession returns null for unknown chat');

upsertSession(CHAT, { state: 'idle', monto_planilla: 1500.0 });
let s = getSession(CHAT);
assert(s !== null, 'upsertSession inserts a new row');
assert(s.state === 'idle', 'state stored correctly');
assert(s.monto_planilla === 1500.0, 'monto_planilla stored correctly');

upsertSession(CHAT, { return_count: 3, return_amount: 250.5 });
s = getSession(CHAT);
assert(s.return_count === 3, 'return_count (int) stored correctly');
assert(s.return_amount === 250.5, 'return_amount (float) stored correctly');

deleteSession(CHAT);
assert(getSession(CHAT) === null, 'deleteSession removes the row');

// ── Test handlers.js helpers ──────────────────────────────────────────────────
console.log('\n── handlers.js ──────────────────────────────────────────────────');

const { buildSummary, fmt } = require('./src/handlers');

assert(fmt(0) === '0.00', 'fmt(0) = "0.00"');
assert(fmt(1500) === '1500.00', 'fmt(1500) = "1500.00"');
assert(fmt(250.5) === '250.50', 'fmt(250.5) = "250.50"');

// Summary with no devoluciones
let summary = buildSummary({ monto_planilla: 2000, return_count: null, return_amount: null });
assert(summary.includes('C$ 2000.00'), 'summary includes monto planilla');
assert(!summary.includes('Devoluciones'), 'summary omits devoluciones when none');
assert(summary.includes('Neto a Entregar: C$ 2000.00'), 'neto = monto when no devs');

// Summary with devoluciones
summary = buildSummary({ monto_planilla: 2000, return_count: 3, return_amount: 250.5 });
assert(summary.includes('Devoluciones (3): - C$ 250.50'), 'summary shows dev count and amount');
assert(summary.includes('Neto a Entregar: C$ 1749.50'), 'neto = monto - return_amount');

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
