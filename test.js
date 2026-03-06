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

// coin_counts roundtrip
upsertSession(CHAT, { coin_counts: { '100': 5, '0.10': 3 } });
s = getSession(CHAT);
assert(typeof s.coin_counts === 'object', 'coin_counts is parsed as object');
assert(s.coin_counts['100'] === 5, 'coin_counts[100] = 5');
assert(s.coin_counts['0.10'] === 3, 'coin_counts[0.10] = 3');

deleteSession(CHAT);
assert(getSession(CHAT) === null, 'deleteSession removes the row');

// ── Test utils.js ─────────────────────────────────────────────────────────────
console.log('\n── utils.js ─────────────────────────────────────────────────────');

const { NIO_DENOMINATIONS, fmt, calculateTotal } = require('./src/utils');

// NIO_DENOMINATIONS must include fractional denominations
assert(NIO_DENOMINATIONS.includes(0.50), 'NIO_DENOMINATIONS includes 0.50');
assert(NIO_DENOMINATIONS.includes(0.25), 'NIO_DENOMINATIONS includes 0.25');
assert(NIO_DENOMINATIONS.includes(0.10), 'NIO_DENOMINATIONS includes 0.10');

// All standard bills present
assert(NIO_DENOMINATIONS.includes(1000), 'NIO_DENOMINATIONS includes 1000');
assert(NIO_DENOMINATIONS.includes(500),  'NIO_DENOMINATIONS includes 500');
assert(NIO_DENOMINATIONS.includes(200),  'NIO_DENOMINATIONS includes 200');
assert(NIO_DENOMINATIONS.includes(100),  'NIO_DENOMINATIONS includes 100');
assert(NIO_DENOMINATIONS.includes(50),   'NIO_DENOMINATIONS includes 50');
assert(NIO_DENOMINATIONS.includes(20),   'NIO_DENOMINATIONS includes 20');
assert(NIO_DENOMINATIONS.includes(10),   'NIO_DENOMINATIONS includes 10');
assert(NIO_DENOMINATIONS.includes(5),    'NIO_DENOMINATIONS includes 5');
assert(NIO_DENOMINATIONS.includes(1),    'NIO_DENOMINATIONS includes 1');

// Coins must come after bills (descending order)
const coins = NIO_DENOMINATIONS.filter((d) => d < 1);
assert(coins.length === 3, 'exactly three fractional denominations (0.50, 0.25, 0.10)');
assert(coins[0] > coins[1] && coins[1] > coins[2], 'fractional denominations in descending order');

// fmt helper
assert(fmt(0) === '0.00', 'fmt(0) = "0.00"');
assert(fmt(1500) === '1500.00', 'fmt(1500) = "1500.00"');
assert(fmt(250.5) === '250.50', 'fmt(250.5) = "250.50"');
assert(fmt(0.10) === '0.10', 'fmt(0.10) = "0.10"');
assert(fmt(0.25) === '0.25', 'fmt(0.25) = "0.25"');
assert(fmt(0.50) === '0.50', 'fmt(0.50) = "0.50"');

// calculateTotal — basic
assert(calculateTotal({ '100': 2 }) === 200, 'calculateTotal: 2×100 = 200');
assert(calculateTotal({ '50': 3 }) === 150, 'calculateTotal: 3×50 = 150');

// calculateTotal — fractional denominations (floating-point safety)
assert(calculateTotal({ '0.10': 3 }) === 0.30, 'calculateTotal: 3×0.10 = 0.30 (no float error)');
assert(calculateTotal({ '0.25': 4 }) === 1.00, 'calculateTotal: 4×0.25 = 1.00');
assert(calculateTotal({ '0.50': 3 }) === 1.50, 'calculateTotal: 3×0.50 = 1.50');
assert(calculateTotal({ '0.10': 10 }) === 1.00, 'calculateTotal: 10×0.10 = 1.00');

// calculateTotal — mixed
const mixed = calculateTotal({ '100': 2, '50': 1, '0.25': 3, '0.10': 7 });
// 200 + 50 + 0.75 + 0.70 = 251.45
assert(mixed === 251.45, `calculateTotal mixed = 251.45 (got ${mixed})`);

// calculateTotal — empty
assert(calculateTotal({}) === 0, 'calculateTotal({}) = 0');

// ── Test handlers.js helpers ──────────────────────────────────────────────────
console.log('\n── handlers.js ──────────────────────────────────────────────────');

const { buildSummary, getNioKeyboard } = require('./src/handlers');

// getNioKeyboard structure
const kb = getNioKeyboard();
assert(kb.reply_markup !== undefined, 'getNioKeyboard returns reply_markup');
const rows = kb.reply_markup.keyboard;
assert(Array.isArray(rows), 'keyboard rows is an array');

// Find the coin row: all three fractional coins should appear together
const allButtons = rows.flat().map((b) => b.text);
assert(allButtons.includes('C$ 0.50'), 'keyboard contains C$ 0.50');
assert(allButtons.includes('C$ 0.25'), 'keyboard contains C$ 0.25');
assert(allButtons.includes('C$ 0.10'), 'keyboard contains C$ 0.10');
assert(allButtons.includes('✅ Listo'), 'keyboard contains ✅ Listo button');

// Coin buttons are on the same row
const coinRowIndex = rows.findIndex((row) =>
  row.some((b) => b.text === 'C$ 0.10')
);
assert(coinRowIndex !== -1, 'found a row with C$ 0.10');
const coinRow = rows[coinRowIndex].map((b) => b.text);
assert(coinRow.includes('C$ 0.50'), 'C$ 0.50 is on the same row as C$ 0.10');
assert(coinRow.includes('C$ 0.25'), 'C$ 0.25 is on the same row as C$ 0.10');

// Summary with no devoluciones
let summary = buildSummary({ monto_planilla: 2000, coin_counts: {}, return_count: null, return_amount: null });
assert(summary.includes('C$ 2000.00'), 'summary includes monto planilla');
assert(!summary.includes('Devoluciones'), 'summary omits devoluciones when none');
assert(summary.includes('Neto a Entregar: C$ 2000.00'), 'neto = monto when no devs');
assert(!summary.includes('Efectivo Contado'), 'summary omits Efectivo when no cash counted');

// Summary with devoluciones
summary = buildSummary({ monto_planilla: 2000, coin_counts: {}, return_count: 3, return_amount: 250.5 });
assert(summary.includes('Devoluciones (3): - C$ 250.50'), 'summary shows dev count and amount');
assert(summary.includes('Neto a Entregar: C$ 1749.50'), 'neto = monto - return_amount');

// Summary with cash counted including fractional denominations
summary = buildSummary({
  monto_planilla: 2000,
  coin_counts: { '0.10': 10, '0.25': 4, '0.50': 2 },
  return_count: null,
  return_amount: null,
});
// 1.00 + 1.00 + 1.00 = 3.00
assert(summary.includes('Efectivo Contado: C$ 3.00'), 'summary shows fractional coin total correctly');

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
