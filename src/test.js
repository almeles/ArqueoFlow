'use strict';

/**
 * ArqueoFlow – inline test suite.
 * Run: node test.js
 */

const {
  USD_BILLS,
  NIO_BILLS,
  NIO_COINS,
  getUsdKeyboard,
  getNioKeyboard,
  getMainMenuKeyboard,
  getActionKeyboard,
  getAdminMenuKeyboard,
  getAdminArqueoKeyboard,
  getPersistentMenu
} = require('./handlers');

const {
  formatNumber,
  formatAmount,
  getStatusEmoji,
  getStatusLabel,
  generateSummary
} = require('./utils');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------
console.log('\n── formatNumber ──');
assert(formatNumber(10000)  === '10,000.00', 'formatNumber(10000)  === "10,000.00"');
assert(formatNumber(500)    === '500.00',    'formatNumber(500)    === "500.00"');
assert(formatNumber(9500)   === '9,500.00',  'formatNumber(9500)   === "9,500.00"');
assert(formatNumber(0.5)    === '0.50',      'formatNumber(0.5)    === "0.50"');
assert(formatNumber(1234567.89) === '1,234,567.89', 'formatNumber(1234567.89)');

// ---------------------------------------------------------------------------
// formatAmount
// ---------------------------------------------------------------------------
console.log('\n── formatAmount ──');
assert(formatAmount(10000) === 'C$ 10,000.00', 'formatAmount(10000) starts with "C$"');
assert(formatAmount(500)   === 'C$    500.00', 'formatAmount(500) right-aligned');
assert(formatAmount(9500)  === 'C$  9,500.00', 'formatAmount(9500) right-aligned');
// All formatted values should be 12 chars wide
assert(formatAmount(10000).length === 12, 'formatAmount width = 12');
assert(formatAmount(500).length   === 12, 'formatAmount(500) width = 12');

// ---------------------------------------------------------------------------
// getStatusEmoji / getStatusLabel
// ---------------------------------------------------------------------------
console.log('\n── getStatusEmoji / getStatusLabel ──');
assert(getStatusEmoji(0)    === '🟢', 'diff=0  → 🟢');
assert(getStatusEmoji(-100) === '🔴', 'diff<0  → 🔴');
assert(getStatusEmoji(100)  === '🟡', 'diff>0  → 🟡');

assert(getStatusLabel(0)    === 'CUADRADO',              'diff=0  label');
assert(getStatusLabel(-200).startsWith('FALTANTE'),      'diff<0  label starts FALTANTE');
assert(getStatusLabel(200).startsWith('SOBRANTE'),       'diff>0  label starts SOBRANTE');

// ---------------------------------------------------------------------------
// generateSummary
// ---------------------------------------------------------------------------
console.log('\n── generateSummary ──');

const summary = generateSummary({
  route:       10081,
  planilla:    10000,
  devolCount:  3,
  devolAmount: 500,
  cashUsd:     3662.43,
  cashNio:     5837.57
});

assert(summary.startsWith('```'),                          'summary wrapped in code block');
assert(summary.includes('ARQUEO DE RUTA 10081'),           'summary contains route');
assert(summary.includes('C$ 10,000.00'),                   'summary contains planilla');
assert(summary.includes('C$    500.00'),                   'summary contains devolAmount');
assert(summary.includes('C$  9,500.00'),                   'summary contains aEntregar');
assert(summary.includes('C$  3,662.43'),                   'summary contains cashUsd');
assert(summary.includes('C$  5,837.57'),                   'summary contains cashNio');
assert(summary.includes('🟢'),                             'summary has green circle (balanced)');
assert(summary.includes('CUADRADO'),                       'summary says CUADRADO');

// deficit case
const summaryDef = generateSummary({
  route: 1, planilla: 1000, devolCount: 0, devolAmount: 0,
  cashUsd: 0, cashNio: 900
});
assert(summaryDef.includes('🔴'),                          'deficit → 🔴');
assert(summaryDef.includes('FALTANTE'),                    'deficit → FALTANTE');

// surplus case
const summarySur = generateSummary({
  route: 1, planilla: 1000, devolCount: 0, devolAmount: 0,
  cashUsd: 0, cashNio: 1100
});
assert(summarySur.includes('🟡'),                          'surplus → 🟡');
assert(summarySur.includes('SOBRANTE'),                    'surplus → SOBRANTE');

// ---------------------------------------------------------------------------
// getUsdKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getUsdKeyboard ──');
const usdKb = getUsdKeyboard({ 100: 2, 1: 5 });

assert(Array.isArray(usdKb.inline_keyboard),               'USD kb has inline_keyboard');

// Collect all denomination buttons
const usdButtons = usdKb.inline_keyboard.flat().filter(b => b.callback_data.startsWith('usd_'));

// Every USD denomination must be present
assert(
  USD_BILLS.every(d => usdButtons.some(b => b.callback_data === `usd_${d}`)),
  'all USD denominations present'
);

// All USD buttons must start with the bill emoji (no country flag)
assert(
  usdButtons.every(b => b.text.startsWith('💵')),
  'USD buttons prefixed with 💵'
);

// Count shown in the label
assert(usdButtons.find(b => b.callback_data === 'usd_100').text.includes('(2)'), 'USD $100 count=2');
assert(usdButtons.find(b => b.callback_data === 'usd_1'  ).text.includes('(5)'), 'USD $1   count=5');

// Action buttons present
const usdActions = usdKb.inline_keyboard.flat().filter(b => b.callback_data.startsWith('action_'));
assert(usdActions.some(b => b.callback_data === 'action_save'   && b.text.includes('💾')), 'USD kb has 💾 Save');
assert(usdActions.some(b => b.callback_data === 'action_cancel' && b.text.includes('❌')), 'USD kb has ❌ Cancel');
assert(usdActions.some(b => b.callback_data === 'action_edit'   && b.text.includes('✏️')), 'USD kb has ✏️ Edit');

// ---------------------------------------------------------------------------
// getNioKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getNioKeyboard ──');
const nioKb = getNioKeyboard({ 500: 3, 5: 10, 0.5: 4 });
const nioButtons = nioKb.inline_keyboard.flat().filter(b => b.callback_data.startsWith('nio_'));

// All NIO denominations must be present
const allNio = [...NIO_BILLS, ...NIO_COINS];
assert(
  allNio.every(d => nioButtons.some(b => b.callback_data === `nio_${d}`)),
  'all NIO denominations present'
);

// Bills use 💵, coins use 🪙 (no country flag prefix)
NIO_BILLS.forEach(d => {
  const btn = nioButtons.find(b => b.callback_data === `nio_${d}`);
  assert(btn && btn.text.startsWith('💵'), `NIO bill C$${d} prefixed with 💵`);
});
NIO_COINS.forEach(d => {
  const btn = nioButtons.find(b => b.callback_data === `nio_${d}`);
  assert(btn && btn.text.startsWith('🪙'), `NIO coin C$${d} prefixed with 🪙`);
});

// Counts reflected
assert(nioButtons.find(b => b.callback_data === 'nio_500').text.includes('(3)'),  'NIO C$500 count=3');
assert(nioButtons.find(b => b.callback_data === 'nio_5'  ).text.includes('(10)'), 'NIO C$5   count=10');
assert(nioButtons.find(b => b.callback_data === 'nio_0.5').text.includes('(4)'),  'NIO C$0.50 count=4');

// Action buttons present
const nioActions = nioKb.inline_keyboard.flat().filter(b => b.callback_data.startsWith('action_'));
assert(nioActions.some(b => b.callback_data === 'action_save'   && b.text.includes('💾')), 'NIO kb has 💾 Save');
assert(nioActions.some(b => b.callback_data === 'action_cancel' && b.text.includes('❌')), 'NIO kb has ❌ Cancel');
assert(nioActions.some(b => b.callback_data === 'action_edit'   && b.text.includes('✏️')), 'NIO kb has ✏️ Edit');

// ---------------------------------------------------------------------------
// getMainMenuKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getMainMenuKeyboard ──');
const mainKb = getMainMenuKeyboard();
const mainButtons = mainKb.inline_keyboard.flat();

assert(mainButtons.some(b => b.callback_data === 'menu_start'   && b.text.includes('🚀')), 'main menu: 🚀 Start Arqueo');
assert(mainButtons.some(b => b.callback_data === 'menu_history' && b.text.includes('📜')), 'main menu: 📜 History');
assert(mainButtons.some(b => b.callback_data === 'menu_admin'   && b.text.includes('🛡️')), 'main menu: 🛡️ Admin');

// ---------------------------------------------------------------------------
// getActionKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getActionKeyboard ──');
const actionKb = getActionKeyboard();
const actionButtons = actionKb.inline_keyboard.flat();

assert(actionButtons.some(b => b.callback_data === 'action_save'   && b.text.includes('💾')), 'action kb: 💾 Save');
assert(actionButtons.some(b => b.callback_data === 'action_cancel' && b.text.includes('❌')), 'action kb: ❌ Cancel');
assert(actionButtons.some(b => b.callback_data === 'action_edit'   && b.text.includes('✏️')), 'action kb: ✏️ Edit');

// ---------------------------------------------------------------------------
// getAdminMenuKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getAdminMenuKeyboard ──');
const adminKb = getAdminMenuKeyboard();
const adminButtons = adminKb.inline_keyboard.flat();

assert(adminButtons.some(b => b.callback_data === 'admin_stats'   && b.text.includes('📊')), 'admin menu: 📊 Estadísticas');
assert(adminButtons.some(b => b.callback_data === 'admin_pending' && b.text.includes('📋')), 'admin menu: 📋 Pendientes');
assert(adminButtons.some(b => b.callback_data === 'admin_all'     && b.text.includes('📁')), 'admin menu: 📁 Todos');
assert(adminButtons.some(b => b.callback_data === 'menu_main'     && b.text.includes('🔙')), 'admin menu: 🔙 Volver');

// ---------------------------------------------------------------------------
// getAdminArqueoKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getAdminArqueoKeyboard ──');
const arqueoKb = getAdminArqueoKeyboard(42);
const arqueoButtons = arqueoKb.inline_keyboard.flat();

assert(arqueoButtons.some(b => b.callback_data === 'admin_approve_42' && b.text.includes('✅')), 'arqueo kb: ✅ Aprobar (id=42)');
assert(arqueoButtons.some(b => b.callback_data === 'admin_reject_42'  && b.text.includes('❌')), 'arqueo kb: ❌ Rechazar (id=42)');
assert(arqueoButtons.some(b => b.callback_data === 'menu_admin'       && b.text.includes('🔙')), 'arqueo kb: 🔙 Volver al menú');

// ---------------------------------------------------------------------------
// getPersistentMenu
// ---------------------------------------------------------------------------
console.log('\n── getPersistentMenu ──');
const persistentMenu = getPersistentMenu();

assert(Array.isArray(persistentMenu),                                 'getPersistentMenu returns array');
assert(persistentMenu.length === 2,                                   'getPersistentMenu has 2 rows');
assert(persistentMenu[0].includes('🚀 Nuevo Arqueo'),                 'row 0 contains 🚀 Nuevo Arqueo');
assert(persistentMenu[1].includes('📄 Mis Reportes'),                 'row 1 contains 📄 Mis Reportes');
assert(persistentMenu[1].includes('🛡️ Admin'),                       'row 1 contains 🛡️ Admin');

// ---------------------------------------------------------------------------
// db – admin helpers (in-memory test database)
// ---------------------------------------------------------------------------
console.log('\n── db admin helpers ──');
{
  // Use an in-memory database so tests never touch the real file
  process.env.DB_PATH = ':memory:';
  // Re-require db with a fresh module instance
  const dbPath = require.resolve('./db');
  delete require.cache[dbPath];
  const testDb = require('./db');

  // Seed two arqueos
  const id1 = testDb.saveArqueo({
    chatId: 1, route: 'T1', planilla: 1000, devolCount: 0, devolAmount: 0,
    cashUsd: 0, cashNio: 1000
  });
  const id2 = testDb.saveArqueo({
    chatId: 2, route: 'T2', planilla: 500, devolCount: 1, devolAmount: 50,
    cashUsd: 0, cashNio: 400
  });

  // getArqueoById
  const a1 = testDb.getArqueoById(id1);
  assert(a1 && a1.route === 'T1',                           'getArqueoById returns correct row');
  assert(testDb.getArqueoById(999999) === undefined,        'getArqueoById returns undefined for missing id');

  // getAllArqueos – no filter
  const all = testDb.getAllArqueos();
  assert(all.length === 2,                                  'getAllArqueos returns all rows');

  // getAllArqueos – status filter
  const cuadrado = testDb.getAllArqueos({ status: 'cuadrado' });
  assert(cuadrado.some(r => r.id === id1),                  'getAllArqueos status=cuadrado includes balanced arqueo');

  const faltante = testDb.getAllArqueos({ status: 'faltante' });
  assert(faltante.some(r => r.id === id2),                  'getAllArqueos status=faltante includes deficit arqueo');

  // getUnreviewedArqueos – both arqueos have auto-computed statuses, not yet approved/rejected
  const unreviewed = testDb.getUnreviewedArqueos();
  assert(unreviewed.length === 2,                           'getUnreviewedArqueos returns both (neither approved/rejected)');

  // updateArqueoStatus
  const changed = testDb.updateArqueoStatus(id1, 'aprobado');
  assert(changed === 1,                                     'updateArqueoStatus returns 1 on success');
  assert(testDb.getArqueoById(id1).status === 'aprobado',   'status updated to aprobado');

  const noChange = testDb.updateArqueoStatus(999999, 'aprobado');
  assert(noChange === 0,                                    'updateArqueoStatus returns 0 for missing id');

  // after approval, getUnreviewedArqueos should exclude it
  const unreviewedAfter = testDb.getUnreviewedArqueos();
  assert(unreviewedAfter.length === 1,                      'getUnreviewedArqueos excludes approved arqueo');
  assert(!unreviewedAfter.some(r => r.id === id1),          'getUnreviewedArqueos does not include approved id');

  // getStats
  const stats = testDb.getStats();
  assert(Array.isArray(stats),                              'getStats returns array');
  assert(stats.some(r => r.status === 'aprobado' && r.count === 1), 'getStats has aprobado=1');
  assert(stats.some(r => r.status === 'faltante' && r.count === 1), 'getStats has faltante=1');
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
