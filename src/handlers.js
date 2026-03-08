'use strict';

// Denominaciones de monedas
const USD_BILLS = [100, 50, 20, 10, 5, 1];
const NIO_BILLS = [1000, 500, 200, 100, 50, 20];
const NIO_COINS = [10, 5, 1, 0.5, 0.25];

/**
 * Genera teclado inline para denominaciones USD (sin bandera)
 */
function getUsdKeyboard(counts = {}) {
  const rows = [];

  // Crear botones de denominaciones USD - SIN bandera 🇺🇸
  for (let i = 0; i < USD_BILLS.length; i += 3) {
    const row = [];
    for (let j = i; j < Math.min(i + 3, USD_BILLS.length); j++) {
      const bill = USD_BILLS[j];
      row.push({
        text: `💵 $${bill} (${counts[bill] || 0})`,
        callback_data: `usd_${bill}`
      });
    }
    rows.push(row);
  }

  // Botones de acción
  rows.push([
    { text: '💾 Guardar', callback_data: 'action_save' },
    { text: '❌ Cancelar', callback_data: 'action_cancel' },
    { text: '✏️ Editar', callback_data: 'action_edit' }
  ]);

  return { inline_keyboard: rows };
}

/**
 * Genera teclado inline para denominaciones NIO (sin bandera)
 */
function getNioKeyboard(counts = {}) {
  const rows = [];

  // Billetes NIO - SIN bandera 🇳🇮
  for (let i = 0; i < NIO_BILLS.length; i += 3) {
    const row = [];
    for (let j = i; j < Math.min(i + 3, NIO_BILLS.length); j++) {
      const bill = NIO_BILLS[j];
      row.push({
        text: `💵 C$${bill} (${counts[bill] || 0})`,
        callback_data: `nio_${bill}`
      });
    }
    rows.push(row);
  }

  // Monedas NIO - SIN bandera 🇳🇮
  for (let i = 0; i < NIO_COINS.length; i += 3) {
    const row = [];
    for (let j = i; j < Math.min(i + 3, NIO_COINS.length); j++) {
      const coin = NIO_COINS[j];
      row.push({
        text: `🪙 C$${coin} (${counts[coin] || 0})`,
        callback_data: `nio_${coin}`
      });
    }
    rows.push(row);
  }

  // Botones de acción
  rows.push([
    { text: '💾 Guardar', callback_data: 'action_save' },
    { text: '❌ Cancelar', callback_data: 'action_cancel' },
    { text: '✏️ Editar', callback_data: 'action_edit' }
  ]);

  return { inline_keyboard: rows };
}

/**
 * Genera teclado del menú principal
 */
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🚀 Iniciar Arqueo', callback_data: 'menu_start' }],
      [{ text: '📜 Historial', callback_data: 'menu_history' }],
      [{ text: '🛡️ Admin', callback_data: 'menu_admin' }]
    ]
  };
}

/**
 * Genera teclado de acciones
 */
function getActionKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '💾 Guardar', callback_data: 'action_save' },
        { text: '❌ Cancelar', callback_data: 'action_cancel' }
      ],
      [{ text: '✏️ Editar', callback_data: 'action_edit' }]
    ]
  };
}

/**
 * Genera teclado del menú de administración
 */
function getAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Estadísticas', callback_data: 'admin_stats' }],
      [{ text: '📋 Pendientes', callback_data: 'admin_pending' }],
      [{ text: '📁 Todos', callback_data: 'admin_all' }],
      [{ text: '🔙 Volver', callback_data: 'menu_main' }]
    ]
  };
}

/**
 * Genera teclado para acciones de administrador en arqueos
 */
function getAdminArqueoKeyboard(arqueoId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Aprobar', callback_data: `admin_approve_${arqueoId}` },
        { text: '❌ Rechazar', callback_data: `admin_reject_${arqueoId}` }
      ],
      [{ text: '🔙 Volver al menú', callback_data: 'menu_admin' }]
    ]
  };
}

/**
 * Genera menú persistente para el bot
 */
function getPersistentMenu() {
  return [
    ['🚀 Nuevo Arqueo'],
    ['📄 Mis Reportes', '🛡️ Admin']
  ];
}

module.exports = {
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
};