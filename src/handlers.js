'use strict';

// ---------------------------------------------------------------------------
// Denomination constants
// ---------------------------------------------------------------------------

/** USD bill denominations (dollars). */
const USD_BILLS = [100, 50, 20, 10, 5, 1];

/** NIO bill denominations (córdobas >= 20). */
const NIO_BILLS = [1000, 500, 200, 100, 50, 20];

/** NIO coin denominations (córdobas <= 10). */
const NIO_COINS = [10, 5, 1, 0.5, 0.25];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the three action buttons (Save / Cancel / Edit) as an inline-keyboard
 * row – reused at the bottom of every denomination keyboard.
 * @returns {Array<Object>}
 */
function _actionRow() {
  return [
    { text: '💾 Save',   callback_data: 'action_save'   },
    { text: '❌ Cancel', callback_data: 'action_cancel' },
    { text: '✏️ Edit',  callback_data: 'action_edit'   }
  ];
}

/**
 * Chunk an array into rows of at most `size` elements.
 * @param {Array} arr
 * @param {number} size
 * @returns {Array<Array>}
 */
function _chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Public keyboard builders
// ---------------------------------------------------------------------------

/**
 * Build an InlineKeyboardMarkup for USD denomination entry.
 *
 * Each button is labelled "💵 $<denom> (<count>)" so the user can see the
 * running tally while tapping.  Three action buttons appear at the bottom.
 *
 * @param {Object} [counts={}]  Map of denomination (number) → count (number).
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getUsdKeyboard(counts = {}) {
  const buttons = USD_BILLS.map(bill => ({
    text: `💵 $${bill} (${counts[bill] || 0})`,
    callback_data: `usd_${bill}`
  }));

  return {
    inline_keyboard: [
      ..._chunk(buttons, 3),
      _actionRow()
    ]
  };
}

/**
 * Build an InlineKeyboardMarkup for NIO denomination entry.
 *
 * Bills are labelled "💵 C$<denom> (<count>)".
 * Coins are labelled "🪙 C$<denom> (<count>)".
 *
 * @param {Object} [counts={}]  Map of denomination (number) → count (number).
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getNioKeyboard(counts = {}) {
  const allDenoms = [...NIO_BILLS, ...NIO_COINS];

  const buttons = allDenoms.map(denom => {
    const isBill  = NIO_BILLS.includes(denom);
    const icon    = isBill ? '💵' : '🪙';
    const label   = Number.isInteger(denom) ? `C$${denom}` : `C$${denom.toFixed(2)}`;
    return {
      text: `${icon} ${label} (${counts[denom] || 0})`,
      callback_data: `nio_${denom}`
    };
  });

  return {
    inline_keyboard: [
      ..._chunk(buttons, 3),
      _actionRow()
    ]
  };
}

/**
 * Build the main-menu InlineKeyboardMarkup.
 *
 * Buttons: 🚀 Start Arqueo | 📜 History | 🛡️ Admin
 *
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🚀 Start Arqueo', callback_data: 'menu_start'   }],
      [{ text: '📜 History',      callback_data: 'menu_history' }],
      [{ text: '🛡️ Admin',       callback_data: 'menu_admin'   }]
    ]
  };
}

/**
 * Build a standalone action InlineKeyboardMarkup (used on the summary screen).
 *
 * Buttons: 💾 Save | ❌ Cancel | ✏️ Edit
 *
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getActionKeyboard() {
  return { inline_keyboard: [_actionRow()] };
}

/**
 * Build the admin-panel main-menu InlineKeyboardMarkup.
 *
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Estadísticas',  callback_data: 'admin_stats'        }],
      [{ text: '📈 Tendencias',    callback_data: 'admin_trends'       }],
      [{ text: '📋 Pendientes',    callback_data: 'admin_pending'      }],
      [{ text: '📁 Todos',         callback_data: 'admin_all'          }],
      [
        { text: '✅ Aprobar Todo', callback_data: 'admin_bulk_approve' },
        { text: '❌ Rechazar Todo',callback_data: 'admin_bulk_reject'  }
      ],
      [{ text: '⚠️ Alertas',       callback_data: 'admin_alerts'       }],
      [{ text: '👥 Usuarios',      callback_data: 'admin_users'        }],
      [{ text: '📄 Plantillas',    callback_data: 'admin_templates'    }],
      [{ text: '📊 CSV Export',    callback_data: 'admin_csv'          }],
      [{ text: '💱 Tipo de Cambio',callback_data: 'admin_exrate'       }],
      [{ text: '🔙 Volver',        callback_data: 'menu_main'          }]
    ]
  };
}

/**
 * Build the admin user-management sub-menu InlineKeyboardMarkup.
 *
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getAdminUserMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '👤 Asignar Rutas', callback_data: 'admin_users_assign' }],
      [{ text: '📋 Ver Usuarios',  callback_data: 'admin_users_list'   }],
      [{ text: '🔙 Volver',        callback_data: 'menu_admin'         }]
    ]
  };
}

/**
 * Build the template-management sub-menu InlineKeyboardMarkup.
 *
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getAdminTemplateMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ Nueva Plantilla',  callback_data: 'admin_template_new'  }],
      [{ text: '🗑️ Borrar Plantilla', callback_data: 'admin_template_del'  }],
      [{ text: '📋 Ver Plantillas',   callback_data: 'admin_template_list' }],
      [{ text: '🔙 Volver',           callback_data: 'menu_admin'          }]
    ]
  };
}

/**
 * Build an InlineKeyboardMarkup for selecting a route template.
 *
 * @param {Array<{id: number, name: string, planilla: number}>} templates
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getRouteTemplatesKeyboard(templates) {
  const rows = templates.map(t => ([{
    text: `📄 ${t.name} (C$${t.planilla.toLocaleString()})`,
    callback_data: `template_${t.id}`
  }]));
  rows.push([{ text: '🚫 Sin Plantilla', callback_data: 'template_none' }]);
  return { inline_keyboard: rows };
}

/**
 * Build the report-filter InlineKeyboardMarkup (date range + CSV export).
 *
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getReportKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📅 Hoy',         callback_data: 'report_today' }],
      [{ text: '📅 Esta Semana', callback_data: 'report_week'  }],
      [{ text: '📅 Este Mes',    callback_data: 'report_month' }],
      [{ text: '📅 Todo',        callback_data: 'report_all'   }],
      [{ text: '📤 Exportar CSV',callback_data: 'report_csv'   }],
      [{ text: '🔙 Volver',      callback_data: 'menu_main'    }]
    ]
  };
}

/**
 * Build an InlineKeyboardMarkup for approving or rejecting a specific arqueo.
 *
 * Buttons: ✅ Aprobar | ❌ Rechazar | 🔙 Volver al menú
 *
 * @param {number} arqueoId
 * @returns {{ inline_keyboard: Array<Array<Object>> }}
 */
function getAdminArqueoKeyboard(arqueoId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Aprobar',       callback_data: `admin_approve_${arqueoId}` },
        { text: '❌ Rechazar',      callback_data: `admin_reject_${arqueoId}`  }
      ],
      [{ text: '🔙 Volver al menú', callback_data: 'menu_admin' }]
    ]
  };
}

/**
 * Return the keyboard rows for a persistent reply keyboard.
 *
 * Row 1: 🚀 Nuevo Arqueo
 * Row 2: 📄 Mis Reportes | 🛡️ Admin
 *
 * @returns {Array<Array<string>>}
 */
function getPersistentMenu() {
  return [
    ['🚀 Nuevo Arqueo'],
    ['📄 Mis Reportes', '🛡️ Admin']
  ];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

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
  getAdminUserMenuKeyboard,
  getAdminTemplateMenuKeyboard,
  getRouteTemplatesKeyboard,
  getReportKeyboard,
  getPersistentMenu,
};