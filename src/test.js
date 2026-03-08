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
  getAdminUserMenuKeyboard,
  getAdminTemplateMenuKeyboard,
  getRouteTemplatesKeyboard,
  getReportKeyboard,
  getPersistentMenu
} = require('./handlers');

const {
  formatNumber,
  formatAmount,
  getStatusEmoji,
  getStatusLabel,
  generateSummary,
  generateCsv
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

// All USD buttons must start with the bill emoji
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

assert(adminButtons.some(b => b.callback_data === 'admin_stats'        && b.text.includes('📊')), 'admin menu: 📊 Estadísticas');
assert(adminButtons.some(b => b.callback_data === 'admin_trends'       && b.text.includes('📈')), 'admin menu: 📈 Tendencias');
assert(adminButtons.some(b => b.callback_data === 'admin_pending'      && b.text.includes('📋')), 'admin menu: 📋 Pendientes');
assert(adminButtons.some(b => b.callback_data === 'admin_all'          && b.text.includes('📁')), 'admin menu: 📁 Todos');
assert(adminButtons.some(b => b.callback_data === 'admin_bulk_approve' && b.text.includes('✅')), 'admin menu: ✅ Aprobar Todo');
assert(adminButtons.some(b => b.callback_data === 'admin_bulk_reject'  && b.text.includes('❌')), 'admin menu: ❌ Rechazar Todo');
assert(adminButtons.some(b => b.callback_data === 'admin_alerts'       && b.text.includes('⚠️')), 'admin menu: ⚠️ Alertas');
assert(adminButtons.some(b => b.callback_data === 'admin_users'        && b.text.includes('👥')), 'admin menu: 👥 Usuarios');
assert(adminButtons.some(b => b.callback_data === 'admin_templates'    && b.text.includes('📄')), 'admin menu: 📄 Plantillas');
assert(adminButtons.some(b => b.callback_data === 'admin_csv'          && b.text.includes('📊')), 'admin menu: 📊 CSV Export');
assert(adminButtons.some(b => b.callback_data === 'admin_exrate'       && b.text.includes('💱')), 'admin menu: 💱 Tipo de Cambio');
assert(adminButtons.some(b => b.callback_data === 'menu_main'          && b.text.includes('🔙')), 'admin menu: 🔙 Volver');

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
// getAdminUserMenuKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getAdminUserMenuKeyboard ──');
const userMenuKb = getAdminUserMenuKeyboard();
const userMenuButtons = userMenuKb.inline_keyboard.flat();

assert(userMenuButtons.some(b => b.callback_data === 'admin_users_assign' && b.text.includes('👤')), 'user menu: 👤 Asignar Rutas');
assert(userMenuButtons.some(b => b.callback_data === 'admin_users_list'   && b.text.includes('📋')), 'user menu: 📋 Ver Usuarios');
assert(userMenuButtons.some(b => b.callback_data === 'menu_admin'         && b.text.includes('🔙')), 'user menu: 🔙 Volver');

// ---------------------------------------------------------------------------
// getAdminTemplateMenuKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getAdminTemplateMenuKeyboard ──');
const tplMenuKb = getAdminTemplateMenuKeyboard();
const tplMenuButtons = tplMenuKb.inline_keyboard.flat();

assert(tplMenuButtons.some(b => b.callback_data === 'admin_template_new'  && b.text.includes('➕')), 'template menu: ➕ Nueva');
assert(tplMenuButtons.some(b => b.callback_data === 'admin_template_del'  && b.text.includes('🗑️')), 'template menu: 🗑️ Borrar');
assert(tplMenuButtons.some(b => b.callback_data === 'admin_template_list' && b.text.includes('📋')), 'template menu: 📋 Ver');
assert(tplMenuButtons.some(b => b.callback_data === 'menu_admin'          && b.text.includes('🔙')), 'template menu: 🔙 Volver');

// ---------------------------------------------------------------------------
// getRouteTemplatesKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getRouteTemplatesKeyboard ──');
const templates = [{ id: 1, name: 'Ruta10081', planilla: 10000 }, { id: 2, name: 'Ruta20000', planilla: 5000 }];
const tplKb = getRouteTemplatesKeyboard(templates);
const tplButtons = tplKb.inline_keyboard.flat();

assert(tplButtons.some(b => b.callback_data === 'template_1'    && b.text.includes('Ruta10081')), 'template kb: template_1');
assert(tplButtons.some(b => b.callback_data === 'template_2'    && b.text.includes('Ruta20000')), 'template kb: template_2');
assert(tplButtons.some(b => b.callback_data === 'template_none' && b.text.includes('🚫')),        'template kb: template_none');

// ---------------------------------------------------------------------------
// getReportKeyboard
// ---------------------------------------------------------------------------
console.log('\n── getReportKeyboard ──');
const reportKb = getReportKeyboard();
const reportButtons = reportKb.inline_keyboard.flat();

assert(reportButtons.some(b => b.callback_data === 'report_today' && b.text.includes('📅')),  'report kb: 📅 Hoy');
assert(reportButtons.some(b => b.callback_data === 'report_week'  && b.text.includes('📅')),  'report kb: 📅 Esta Semana');
assert(reportButtons.some(b => b.callback_data === 'report_month' && b.text.includes('📅')),  'report kb: 📅 Este Mes');
assert(reportButtons.some(b => b.callback_data === 'report_all'   && b.text.includes('📅')),  'report kb: 📅 Todo');
assert(reportButtons.some(b => b.callback_data === 'report_csv'   && b.text.includes('📤')),  'report kb: 📤 Exportar CSV');
assert(reportButtons.some(b => b.callback_data === 'menu_main'    && b.text.includes('🔙')),  'report kb: 🔙 Volver');

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
// generateCsv
// ---------------------------------------------------------------------------
console.log('\n── generateCsv ──');
const csvRows = [
  { id: 1, chat_id: 100, route: 'T1', planilla: 1000, devol_count: 0, devol_amount: 0,
    cash_usd: 0, cash_nio: 1000, total_caja: 1000, diff: 0, status: 'cuadrado', created_at: '2024-01-01' },
  { id: 2, chat_id: 200, route: 'T2,comma', planilla: 500, devol_count: 1, devol_amount: 50,
    cash_usd: 100, cash_nio: 350, total_caja: 450, diff: -50, status: 'faltante', created_at: '2024-01-02' }
];

const csvOutput = generateCsv(csvRows);
const csvLines  = csvOutput.split('\n');

assert(csvLines[0].startsWith('id,chat_id,route'),              'CSV has correct header');
assert(csvLines.length === 3,                                   'CSV has header + 2 data rows');
assert(csvLines[1].startsWith('1,100,'),                       'first data row starts with id=1');
assert(csvLines[2].startsWith('2,200,'),                       'second data row starts with id=2');
// Check that commas inside route names are quoted
assert(csvLines[2].includes('"T2,comma"'),                      'CSV quotes route with embedded comma');
assert(csvLines[2].includes('-50'),                             'CSV contains negative diff');

// ---------------------------------------------------------------------------
// db – extended helpers (in-memory test database)
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

  // ── New helpers ─────────────────────────────────────────────────────────

  // bulkUpdateArqueoStatus
  const id3 = testDb.saveArqueo({ chatId: 3, route: 'T3', planilla: 200, devolCount: 0, devolAmount: 0, cashUsd: 0, cashNio: 100 });
  const id4 = testDb.saveArqueo({ chatId: 3, route: 'T4', planilla: 200, devolCount: 0, devolAmount: 0, cashUsd: 0, cashNio: 300 });
  const bulkChanged = testDb.bulkUpdateArqueoStatus([id3, id4], 'aprobado');
  assert(bulkChanged === 2,                                 'bulkUpdateArqueoStatus returns 2 changed');
  assert(testDb.getArqueoById(id3).status === 'aprobado',  'bulk: id3 is aprobado');
  assert(testDb.getArqueoById(id4).status === 'aprobado',  'bulk: id4 is aprobado');
  assert(testDb.bulkUpdateArqueoStatus([], 'aprobado') === 0, 'bulkUpdateArqueoStatus on empty ids = 0');

  // getArqueosByFilter
  const filtered = testDb.getArqueosByFilter({ chatId: 3 });
  assert(filtered.length === 2,                             'getArqueosByFilter by chatId returns 2');
  const filteredStatus = testDb.getArqueosByFilter({ status: 'faltante' });
  assert(filteredStatus.some(r => r.id === id2),            'getArqueosByFilter by status=faltante includes id2');

  // getDiscrepancies
  const discrep = testDb.getDiscrepancies(0, 10);
  assert(Array.isArray(discrep),                            'getDiscrepancies returns array');
  // id2 is faltante (diff < 0) and not yet approved
  assert(discrep.some(r => r.id === id2),                   'getDiscrepancies includes faltante arqueo');
  // id1 is aprobado, should not appear
  assert(!discrep.some(r => r.id === id1),                  'getDiscrepancies excludes approved arqueo');

  // getWeeklyStats
  const weekly = testDb.getWeeklyStats(4);
  assert(Array.isArray(weekly),                             'getWeeklyStats returns array');

  // User management
  testDb.upsertUser(100, 'alice', ['T1', 'T2']);
  const user100 = testDb.getUser(100);
  assert(user100 !== undefined,                              'getUser returns inserted user');
  assert(user100.username === 'alice',                       'getUser username = alice');
  assert(Array.isArray(user100.assigned_routes),             'assigned_routes is array');
  assert(user100.assigned_routes.length === 2,               'user has 2 assigned routes');
  assert(user100.assigned_routes.includes('T1'),             'user has route T1');

  // canUserAccessRoute
  assert(testDb.canUserAccessRoute(100, 'T1') === true,      'alice can access T1');
  assert(testDb.canUserAccessRoute(100, 'T99') === false,    'alice cannot access T99');
  assert(testDb.canUserAccessRoute(999, 'ANY') === true,     'unknown user can access any route');

  // upsertUser – update: set empty routes (unrestricted)
  testDb.upsertUser(100, 'alice', []);
  assert(testDb.canUserAccessRoute(100, 'T99') === true,     'alice with empty routes can access T99');

  // setUserActive
  testDb.upsertUser(200, 'bob', ['T1']);
  testDb.setUserActive(200, false);
  assert(testDb.canUserAccessRoute(200, 'T1') === false,     'inactive user cannot access any route');
  testDb.setUserActive(200, true);
  assert(testDb.canUserAccessRoute(200, 'T1') === true,      'reactivated user can access T1 again');

  // getAllUsers
  const allUsers = testDb.getAllUsers();
  assert(Array.isArray(allUsers),                            'getAllUsers returns array');
  assert(allUsers.some(u => u.chat_id === 100),              'getAllUsers includes user 100');

  // logAction / getActionLogs
  testDb.logAction(100, 'test_action', { foo: 'bar' });
  testDb.logAction(100, 'another_action', null);
  const logs = testDb.getActionLogs({ chatId: 100 });
  assert(logs.length >= 2,                                   'getActionLogs returns logged actions');
  assert(logs.some(l => l.action === 'test_action'),         'log contains test_action');
  assert(logs.some(l => l.action === 'another_action'),      'log contains another_action');
  const allLogs = testDb.getActionLogs();
  assert(Array.isArray(allLogs),                             'getActionLogs (no filter) returns array');

  // Route templates
  const tId1 = testDb.saveRouteTemplate('Ruta-A', 10000);
  const tId2 = testDb.saveRouteTemplate('Ruta-B', 5000);
  const tpls = testDb.getRouteTemplates();
  assert(tpls.length >= 2,                                   'getRouteTemplates returns saved templates');
  assert(tpls.some(t => t.name === 'Ruta-A'),                'templates include Ruta-A');
  assert(tpls.some(t => t.name === 'Ruta-B'),                'templates include Ruta-B');
  // Templates are ordered by name
  const names = tpls.map(t => t.name);
  assert(names.indexOf('Ruta-A') < names.indexOf('Ruta-B'), 'templates ordered alphabetically');
  // Delete
  const delCount = testDb.deleteRouteTemplate(tId1);
  assert(delCount === 1,                                     'deleteRouteTemplate returns 1');
  assert(!testDb.getRouteTemplates().some(t => t.id === tId1), 'deleted template no longer returned');
  assert(testDb.deleteRouteTemplate(999999) === 0,           'delete missing template returns 0');

  // Settings
  testDb.setSetting('exchange_rate', 37.25);
  assert(testDb.getSetting('exchange_rate') === '37.25',     'getSetting returns stored exchange rate');
  testDb.setSetting('exchange_rate', 38.00);
  assert(testDb.getSetting('exchange_rate') === '38',        'setSetting upserts (overwrites)');
  assert(testDb.getSetting('nonexistent_key') === null,      'getSetting returns null for missing key');
  assert(testDb.getSetting('nonexistent_key', 'def') === 'def', 'getSetting returns defaultValue when missing');
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
