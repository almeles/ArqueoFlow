'use strict';

const TelegramBot = require('node-telegram-bot-api');
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
const { generateSummary, generateCsv } = require('./utils');
const db = require('./db');

const TOKEN = process.env.BOT_TOKEN;
/** Default USD → C$ exchange rate; override via EXCHANGE_RATE env var or /setrate command. */
const EXCHANGE_RATE = parseFloat(process.env.EXCHANGE_RATE || '36.50');
if (!TOKEN) {
  console.error('BOT_TOKEN environment variable is required.');
  process.exit(1);
}

/**
 * Chat IDs allowed to access the admin panel.
 * Set the ADMIN_CHAT_IDS environment variable to a comma-separated list, e.g.:
 *   ADMIN_CHAT_IDS=123456789,987654321
 */
const ADMIN_CHAT_IDS = new Set(
  (process.env.ADMIN_CHAT_IDS || process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
);

/** @param {number} chatId @returns {boolean} */
function isAdmin(chatId) {
  return ADMIN_CHAT_IDS.has(chatId);
}

/** Session inactivity timeout in ms (default 30 min). */
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || String(30 * 60 * 1000), 10);

/** Return the current exchange rate (DB setting overrides env var). */
function getExchangeRate() {
  const stored = db.getSetting('exchange_rate');
  return stored ? parseFloat(stored) : EXCHANGE_RATE;
}

/**
 * Notify every configured admin chat about an event.
 * @param {string} message  Markdown text.
 */
async function notifyAdmins(message) {
  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
    } catch (_) { /* swallow per-admin delivery errors */ }
  }
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ---------------------------------------------------------------------------
// Session store (in-memory)
// ---------------------------------------------------------------------------

/** @type {Map<number, Object>} */
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { step: 'idle', arqueo: {}, lastActivity: Date.now() });
  }
  const session = sessions.get(chatId);
  // Reset timed-out sessions so stale wizard state cannot be abused
  if (Date.now() - (session.lastActivity || 0) > SESSION_TIMEOUT_MS) {
    const fresh = { step: 'idle', arqueo: {}, lastActivity: Date.now() };
    sessions.set(chatId, fresh);
    return fresh;
  }
  session.lastActivity = Date.now();
  return session;
}

// ---------------------------------------------------------------------------
// USD / NIO cash calculator
// ---------------------------------------------------------------------------

/**
 * Sum up the total cash value for a set of denomination counts.
 *
 * @param {number[]}  denoms  Denomination list
 * @param {Object}    counts  denomination → count
 * @returns {number}
 */
function sumDenoms(denoms, counts) {
  return denoms.reduce((acc, d) => acc + d * (counts[d] || 0), 0);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sessions.set(chatId, { step: 'menu', arqueo: {}, lastActivity: Date.now() });
  db.logAction(chatId, 'start');
  bot.sendMessage(chatId, 'Bienvenido a *ArqueoFlow* 🧾', {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: getPersistentMenu(),
      resize_keyboard: true,
      one_time_keyboard: false
    }
  });
});

// ---------------------------------------------------------------------------
// Admin: set exchange rate
// ---------------------------------------------------------------------------

bot.onText(/\/setrate (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '🚫 Acceso denegado.');
    return;
  }
  const rate = parseFloat(match[1]);
  if (isNaN(rate) || rate <= 0) {
    bot.sendMessage(chatId, '⚠️ Tipo de cambio inválido. Ejemplo: /setrate 36.50');
    return;
  }
  db.setSetting('exchange_rate', rate);
  db.logAction(chatId, 'set_exchange_rate', { rate });
  bot.sendMessage(chatId, `✅ Tipo de cambio actualizado a *${rate} C$/USD*.`, { parse_mode: 'Markdown' });
});

// ---------------------------------------------------------------------------
// Callback-query handler
// ---------------------------------------------------------------------------

/** Helper: status → emoji */
function statusEmoji(s) {
  return s === 'cuadrado' ? '🟢'
    : s === 'faltante'  ? '🔴'
    : s === 'sobrante'  ? '🟡'
    : s === 'aprobado'  ? '✅'
    : s === 'rechazado' ? '❌'
    : '⬜';
}

bot.on('callback_query', async (query) => {
  const chatId  = query.message.chat.id;
  const data    = query.data;
  const session = getSession(chatId);

  await bot.answerCallbackQuery(query.id);

  // ── Main menu ────────────────────────────────────────────────────────────
  if (data === 'menu_start') {
    const templates = db.getRouteTemplates();
    if (templates.length > 0) {
      session.step   = 'select_template';
      session.arqueo = {};
      await bot.sendMessage(chatId, '📄 Seleccione una plantilla o ingrese datos manualmente:', {
        reply_markup: getRouteTemplatesKeyboard(templates)
      });
    } else {
      session.step   = 'route';
      session.arqueo = {};
      await bot.sendMessage(chatId, '📋 Ingrese el número de ruta:');
    }

  } else if (data === 'menu_history') {
    await bot.sendMessage(chatId, '📄 *Mis Reportes* — seleccione rango:', {
      parse_mode: 'Markdown',
      reply_markup: getReportKeyboard()
    });

  } else if (data === 'menu_admin') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado. No tienes permisos de administrador.', {
        reply_markup: getMainMenuKeyboard()
      });
    } else {
      await bot.sendMessage(chatId, '🛡️ *Panel de Administración*', {
        parse_mode: 'Markdown',
        reply_markup: getAdminMenuKeyboard()
      });
    }

  // ── Admin: back to main ──────────────────────────────────────────────────
  } else if (data === 'menu_main') {
    await bot.sendMessage(chatId, 'Bienvenido a *ArqueoFlow* 🧾', {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });

  // ── Report: date-filtered history ────────────────────────────────────────
  } else if (data.startsWith('report_')) {
    const now   = new Date();
    let from    = null;
    let to      = null;
    const today = now.toISOString().slice(0, 10);

    if (data === 'report_today') {
      from = today; to = today;
    } else if (data === 'report_week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      from = d.toISOString().slice(0, 10); to = today;
    } else if (data === 'report_month') {
      from = `${today.slice(0, 7)}-01`; to = today;
    } else if (data === 'report_csv') {
      // CSV export for user's own arqueos
      const all = db.getArqueosByFilter({ chatId, limit: 500 });
      if (all.length === 0) {
        await bot.sendMessage(chatId, '📤 No hay arqueos para exportar.', {
          reply_markup: getReportKeyboard()
        });
      } else {
        const csv = generateCsv(all);
        await bot.sendDocument(chatId,
          Buffer.from(csv, 'utf8'),
          { caption: '📤 Exportación CSV de tus arqueos' },
          { filename: `arqueos_${chatId}_${today}.csv`, contentType: 'text/csv' }
        );
      }
      return;
    }

    const history = db.getArqueosByFilter({ chatId, from, to, limit: 20 });
    const text = history.length
      ? history.map(a =>
          `${statusEmoji(a.status)} #${a.id} Ruta ${a.route} | C$${a.total_caja.toFixed(2)} | ${a.status} | ${String(a.created_at).slice(0, 10)}`
        ).join('\n')
      : 'No hay arqueos en ese período.';
    await bot.sendMessage(chatId, text, { reply_markup: getReportKeyboard() });

  // ── Route template selection ─────────────────────────────────────────────
  } else if (data.startsWith('template_')) {
    const templateId = data.slice('template_'.length);
    if (templateId === 'none') {
      session.step   = 'route';
      session.arqueo = {};
      await bot.sendMessage(chatId, '📋 Ingrese el número de ruta:');
    } else {
      const id       = parseInt(templateId, 10);
      const template = db.getRouteTemplates().find(t => t.id === id);
      if (template) {
        if (!db.canUserAccessRoute(chatId, template.name)) {
          await bot.sendMessage(chatId, `🚫 No tienes permiso para acceder a la ruta *${template.name}*.`, {
            parse_mode: 'Markdown',
            reply_markup: getMainMenuKeyboard()
          });
          return;
        }
        session.arqueo         = { route: template.name, planilla: template.planilla };
        session.step           = 'devol_count';
        db.logAction(chatId, 'template_selected', { templateId: id, route: template.name });
        await bot.sendMessage(chatId,
          `✅ Plantilla: *${template.name}* (C$${template.planilla.toFixed(2)})\n🔄 ¿Cuántas devoluciones hubo? (0 si ninguna):`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, '⚠️ Plantilla no encontrada.', { reply_markup: getMainMenuKeyboard() });
      }
    }

  // ── Admin: stats ─────────────────────────────────────────────────────────
  } else if (data === 'admin_stats') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const stats = db.getStats();
      let text = '📊 *Estadísticas Generales*\n\n';
      if (stats.length === 0) {
        text += 'No hay arqueos registrados.';
      } else {
        stats.forEach(row => {
          text += `${statusEmoji(row.status)} ${row.status.toUpperCase()}: ${row.count}\n`;
        });
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: getAdminMenuKeyboard()
      });
    }

  // ── Admin: historical trends ─────────────────────────────────────────────
  } else if (data === 'admin_trends') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const rows = db.getWeeklyStats(4);
      if (rows.length === 0) {
        await bot.sendMessage(chatId, '📈 No hay datos de tendencias aún.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        let text = '📈 *Tendencias por Semana*\n\n';
        rows.forEach(r => {
          text += `${r.week} ${statusEmoji(r.status)} ${r.status}: ${r.count} (C$${(r.total_amount || 0).toFixed(2)})\n`;
        });
        await bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: list pending (unreviewed) ─────────────────────────────────────
  } else if (data === 'admin_pending') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const unreviewed = db.getUnreviewedArqueos(5);
      if (unreviewed.length === 0) {
        await bot.sendMessage(chatId, '📋 No hay arqueos sin revisar.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        for (const a of unreviewed) {
          const text = `🆔 #${a.id} | Ruta ${a.route} | Chat ${a.chat_id}\n`
            + `💰 Planilla: C$${a.planilla.toFixed(2)} | Devol: ${a.devol_count} (C$${a.devol_amount.toFixed(2)})\n`
            + `💵 USD: C$${a.cash_usd.toFixed(2)} | 🇳🇮 NIO: C$${a.cash_nio.toFixed(2)}\n`
            + `🧾 Total: C$${a.total_caja.toFixed(2)} | Diff: C$${a.diff.toFixed(2)}\n`
            + `${statusEmoji(a.status)} ${a.status.toUpperCase()} | 📅 ${a.created_at}`;
          await bot.sendMessage(chatId, text, {
            reply_markup: getAdminArqueoKeyboard(a.id)
          });
        }
        await bot.sendMessage(chatId, '— Fin de pendientes —', {
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: list all ───────────────────────────────────────────────────────
  } else if (data === 'admin_all') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const all = db.getAllArqueos({ limit: 10 });
      if (all.length === 0) {
        await bot.sendMessage(chatId, '📁 No hay arqueos registrados.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        const lines = all.map(a =>
          `${statusEmoji(a.status)} #${a.id} Ruta ${a.route} | C$${a.total_caja.toFixed(2)} | ${a.status}`
        );
        await bot.sendMessage(chatId, `📁 *Últimos arqueos:*\n\n${lines.join('\n')}`, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: bulk approve ───────────────────────────────────────────────────
  } else if (data === 'admin_bulk_approve') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const pending = db.getUnreviewedArqueos(100);
      if (pending.length === 0) {
        await bot.sendMessage(chatId, '📋 No hay arqueos pendientes.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        const ids     = pending.map(a => a.id);
        const changed = db.bulkUpdateArqueoStatus(ids, 'aprobado');
        db.logAction(chatId, 'bulk_approve', { count: changed, ids });
        await bot.sendMessage(chatId, `✅ *${changed}* arqueos aprobados en lote.`, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: bulk reject ────────────────────────────────────────────────────
  } else if (data === 'admin_bulk_reject') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const pending = db.getUnreviewedArqueos(100);
      if (pending.length === 0) {
        await bot.sendMessage(chatId, '📋 No hay arqueos pendientes.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        const ids     = pending.map(a => a.id);
        const changed = db.bulkUpdateArqueoStatus(ids, 'rechazado');
        db.logAction(chatId, 'bulk_reject', { count: changed, ids });
        await bot.sendMessage(chatId, `❌ *${changed}* arqueos rechazados en lote.`, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: discrepancy alerts ─────────────────────────────────────────────
  } else if (data === 'admin_alerts') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const discrepancies = db.getDiscrepancies(0, 10);
      if (discrepancies.length === 0) {
        await bot.sendMessage(chatId, '✅ No hay discrepancias sin revisar.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        let text = '⚠️ *Alertas de Discrepancias*\n\n';
        discrepancies.forEach(a => {
          text += `${statusEmoji(a.status)} #${a.id} Ruta ${a.route} | Diff: C$${a.diff.toFixed(2)} | ${a.created_at}\n`;
        });
        await bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: user management ────────────────────────────────────────────────
  } else if (data === 'admin_users') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      await bot.sendMessage(chatId, '👥 *Gestión de Usuarios*', {
        parse_mode: 'Markdown',
        reply_markup: getAdminUserMenuKeyboard()
      });
    }

  } else if (data === 'admin_users_assign') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      session.step = 'admin_assign_waiting_chat_id';
      await bot.sendMessage(chatId, '🔢 Ingrese el *Chat ID* del usuario al que desea asignar rutas:', {
        parse_mode: 'Markdown'
      });
    }

  } else if (data === 'admin_users_list') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const users = db.getAllUsers();
      if (users.length === 0) {
        await bot.sendMessage(chatId, '👥 No hay usuarios registrados.', {
          reply_markup: getAdminUserMenuKeyboard()
        });
      } else {
        let text = '👥 *Usuarios Registrados*\n\n';
        users.forEach(u => {
          const routes = u.assigned_routes.length > 0 ? u.assigned_routes.join(', ') : 'Sin restricciones';
          const active = u.is_active ? '✅' : '🔴';
          text += `${active} ID: ${u.chat_id}${u.username ? ` (@${u.username})` : ''}\n   Rutas: ${routes}\n`;
        });
        await bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: getAdminUserMenuKeyboard()
        });
      }
    }

  // ── Admin: template management ────────────────────────────────────────────
  } else if (data === 'admin_templates') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      await bot.sendMessage(chatId, '📄 *Gestión de Plantillas*', {
        parse_mode: 'Markdown',
        reply_markup: getAdminTemplateMenuKeyboard()
      });
    }

  } else if (data === 'admin_template_new') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      session.step = 'admin_template_waiting_name';
      await bot.sendMessage(chatId, '📝 Ingrese el *nombre* (ruta) para la nueva plantilla:', {
        parse_mode: 'Markdown'
      });
    }

  } else if (data === 'admin_template_list') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const templates = db.getRouteTemplates();
      if (templates.length === 0) {
        await bot.sendMessage(chatId, '📄 No hay plantillas creadas.', {
          reply_markup: getAdminTemplateMenuKeyboard()
        });
      } else {
        let text = '📄 *Plantillas*\n\n';
        templates.forEach(t => {
          text += `🆔 #${t.id} | ${t.name} | C$${t.planilla.toFixed(2)}\n`;
        });
        await bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: getAdminTemplateMenuKeyboard()
        });
      }
    }

  } else if (data === 'admin_template_del') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      session.step = 'admin_template_waiting_del_id';
      await bot.sendMessage(chatId, '🆔 Ingrese el *ID* de la plantilla a borrar:', {
        parse_mode: 'Markdown'
      });
    }

  // ── Admin: CSV export (all arqueos) ──────────────────────────────────────
  } else if (data === 'admin_csv') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const all = db.getArqueosByFilter({ limit: 1000 });
      if (all.length === 0) {
        await bot.sendMessage(chatId, '📤 No hay arqueos para exportar.', {
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        const csv     = generateCsv(all);
        const today   = new Date().toISOString().slice(0, 10);
        await bot.sendDocument(chatId,
          Buffer.from(csv, 'utf8'),
          { caption: `📤 Exportación CSV completa (${all.length} arqueos)` },
          { filename: `arqueos_admin_${today}.csv`, contentType: 'text/csv' }
        );
        db.logAction(chatId, 'admin_csv_export', { count: all.length });
      }
    }

  // ── Admin: exchange rate info ─────────────────────────────────────────────
  } else if (data === 'admin_exrate') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const rate = getExchangeRate();
      await bot.sendMessage(chatId,
        `💱 Tipo de cambio actual: *${rate} C$/USD*\n\nUse /setrate <valor> para actualizarlo.`,
        { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() }
      );
    }

  // ── Admin: approve ────────────────────────────────────────────────────────
  } else if (data.startsWith('admin_approve_')) {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const id      = parseInt(data.slice('admin_approve_'.length), 10);
      const changed = db.updateArqueoStatus(id, 'aprobado');
      if (changed) {
        db.logAction(chatId, 'approve', { arqueoId: id });
        await bot.sendMessage(chatId, `✅ Arqueo #${id} *aprobado*.`, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        await bot.sendMessage(chatId, `⚠️ Arqueo #${id} no encontrado.`, {
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: reject ─────────────────────────────────────────────────────────
  } else if (data.startsWith('admin_reject_')) {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const id      = parseInt(data.slice('admin_reject_'.length), 10);
      const changed = db.updateArqueoStatus(id, 'rechazado');
      if (changed) {
        db.logAction(chatId, 'reject', { arqueoId: id });
        await bot.sendMessage(chatId, `❌ Arqueo #${id} *rechazado*.`, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      } else {
        await bot.sendMessage(chatId, `⚠️ Arqueo #${id} no encontrado.`, {
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── USD denomination taps ────────────────────────────────────────────────
  } else if (data.startsWith('usd_')) {
    const bill = parseFloat(data.slice(4));
    session.step            = 'awaiting_qty';
    session.currentDenom    = bill;
    session.currentCurrency = 'usd';
    await bot.sendMessage(chatId, `🔢 ¿Cuántos billetes de $${bill} tienes?`, {
      reply_markup: { force_reply: true }
    });

  // ── NIO denomination taps ────────────────────────────────────────────────
  } else if (data.startsWith('nio_')) {
    const denom = parseFloat(data.slice(4));
    session.step            = 'awaiting_qty';
    session.currentDenom    = denom;
    session.currentCurrency = 'nio';
    const label = NIO_BILLS.includes(denom) ? 'billetes' : 'monedas';
    await bot.sendMessage(chatId, `🔢 ¿Cuántas ${label} de C$${denom} tienes?`, {
      reply_markup: { force_reply: true }
    });

  // ── Action: Save ─────────────────────────────────────────────────────────
  } else if (data === 'action_save') {
    if (session.step === 'usd') {
      const exchRate = getExchangeRate();
      session.arqueo.cashUsd = sumDenoms(USD_BILLS, session.arqueo.usdCounts || {}) * exchRate;
      session.step           = 'nio';
      session.arqueo.nioCounts = {};
      await bot.sendMessage(chatId, '🇳🇮 Conteo NIO. Toque cada billete/moneda:', {
        reply_markup: getNioKeyboard({})
      });

    } else if (session.step === 'nio') {
      session.arqueo.cashNio = sumDenoms([...NIO_BILLS, ...NIO_COINS], session.arqueo.nioCounts || {});
      session.step           = 'summary';
      const summary = generateSummary(session.arqueo);
      await bot.sendMessage(chatId, summary, {
        parse_mode: 'MarkdownV2',
        reply_markup: getActionKeyboard()
      });

    } else if (session.step === 'summary') {
      const id = db.saveArqueo({ chatId, ...session.arqueo });
      db.logAction(chatId, 'arqueo_saved', { arqueoId: id, route: session.arqueo.route });
      sessions.set(chatId, { step: 'menu', arqueo: {}, lastActivity: Date.now() });
      await bot.sendMessage(chatId, `✅ Arqueo #${id} guardado.`, {
        reply_markup: getMainMenuKeyboard()
      });
      // Notify admins of the new submission
      await notifyAdmins(
        `📋 Nuevo arqueo *#${id}* guardado\\.\nRuta: ${session.arqueo.route} | Total: C$${(session.arqueo.cashUsd + session.arqueo.cashNio).toFixed(2)}`
          .replace(/[_*[\]()~`>#+\-=|{}.!]/g, c => `\\${c}`)
      );
    }

  // ── Action: Cancel ───────────────────────────────────────────────────────
  } else if (data === 'action_cancel') {
    db.logAction(chatId, 'arqueo_cancelled', { route: session.arqueo.route });
    sessions.set(chatId, { step: 'menu', arqueo: {}, lastActivity: Date.now() });
    await bot.sendMessage(chatId, '❌ Arqueo cancelado.', {
      reply_markup: getMainMenuKeyboard()
    });

  // ── Action: Edit ─────────────────────────────────────────────────────────
  } else if (data === 'action_edit') {
    session.step   = 'route';
    session.arqueo = {};
    await bot.sendMessage(chatId, '✏️ Nuevo arqueo.\n📋 Ingrese el número de ruta:');
  }
});

// ---------------------------------------------------------------------------
// Text-message handler (wizard steps)
// ---------------------------------------------------------------------------

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId  = msg.chat.id;
  const session = getSession(chatId);
  const text    = msg.text.trim();

  // ── Persistent menu button handlers ────────────────────────────────────
  if (text === '🚀 Nuevo Arqueo') {
    const templates = db.getRouteTemplates();
    if (templates.length > 0) {
      session.step   = 'select_template';
      session.arqueo = {};
      await bot.sendMessage(chatId, '📄 Seleccione una plantilla o ingrese datos manualmente:', {
        reply_markup: getRouteTemplatesKeyboard(templates)
      });
    } else {
      session.step   = 'route';
      session.arqueo = {};
      await bot.sendMessage(chatId, '📋 Ingrese el número de ruta:');
    }
    return;
  } else if (text === '📄 Mis Reportes') {
    await bot.sendMessage(chatId, '📄 *Mis Reportes* — seleccione rango:', {
      parse_mode: 'Markdown',
      reply_markup: getReportKeyboard()
    });
    return;
  } else if (text === '🛡️ Admin') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado. No tienes permisos de administrador.', {
        reply_markup: getMainMenuKeyboard()
      });
    } else {
      await bot.sendMessage(chatId, '🛡️ *Panel de Administración*', {
        parse_mode: 'Markdown',
        reply_markup: getAdminMenuKeyboard()
      });
    }
    return;
  }

  // ── Arqueo wizard ────────────────────────────────────────────────────────
  if (session.step === 'route') {
    // Enforce route access
    if (!db.canUserAccessRoute(chatId, text)) {
      await bot.sendMessage(chatId, `🚫 No tienes permiso para acceder a la ruta *${text}*.`, {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard()
      });
      return;
    }
    session.arqueo.route = text;
    session.step = 'planilla';
    await bot.sendMessage(chatId, '💰 Ingrese el monto de la planilla (C$):');

  } else if (session.step === 'planilla') {
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount) || amount < 0) {
      await bot.sendMessage(chatId, '⚠️ Monto inválido. Ingrese un número positivo:');
      return;
    }
    session.arqueo.planilla = amount;
    session.step = 'devol_count';
    await bot.sendMessage(chatId, '🔄 ¿Cuántas devoluciones hubo? (0 si ninguna):');

  } else if (session.step === 'devol_count') {
    const count = parseInt(text, 10);
    if (isNaN(count) || count < 0) {
      await bot.sendMessage(chatId, '⚠️ Número inválido. Ingrese un entero ≥ 0:');
      return;
    }
    session.arqueo.devolCount = count;
    if (count === 0) {
      session.arqueo.devolAmount = 0;
      session.step              = 'usd';
      session.arqueo.usdCounts  = {};
      await bot.sendMessage(chatId, '🇺🇸 Conteo USD. Toque cada billete para incrementar:', {
        reply_markup: getUsdKeyboard({})
      });
    } else {
      session.step = 'devol_amount';
      await bot.sendMessage(chatId, '💸 Ingrese el monto total de devoluciones (C$):');
    }

  } else if (session.step === 'devol_amount') {
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount) || amount < 0) {
      await bot.sendMessage(chatId, '⚠️ Monto inválido. Ingrese un número positivo:');
      return;
    }
    session.arqueo.devolAmount = amount;
    session.step              = 'usd';
    session.arqueo.usdCounts  = {};
    await bot.sendMessage(chatId, '🇺🇸 Conteo USD. Toque cada billete para incrementar:', {
      reply_markup: getUsdKeyboard({})
    });

  } else if (session.step === 'awaiting_qty') {
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty < 0) {
      await bot.sendMessage(chatId, '⚠️ Por favor ingresa un número válido (0 o más).');
      return;
    }

    const denom    = session.currentDenom;
    const currency = session.currentCurrency;

    if (currency === 'usd') {
      session.arqueo.usdCounts         = session.arqueo.usdCounts || {};
      session.arqueo.usdCounts[denom]  = qty;
      session.step = 'usd';
      await bot.sendMessage(chatId, `✅ Guardado: ${qty} x $${denom}`, {
        reply_markup: getUsdKeyboard(session.arqueo.usdCounts)
      });
    } else {
      session.arqueo.nioCounts         = session.arqueo.nioCounts || {};
      session.arqueo.nioCounts[denom]  = qty;
      session.step = 'nio';
      await bot.sendMessage(chatId, `✅ Guardado: ${qty} x C$${denom}`, {
        reply_markup: getNioKeyboard(session.arqueo.nioCounts)
      });
    }

  // ── Admin wizard steps ───────────────────────────────────────────────────
  } else if (session.step === 'admin_assign_waiting_chat_id') {
    if (!isAdmin(chatId)) {
      session.step = 'idle';
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
      return;
    }
    const targetId = parseInt(text, 10);
    if (isNaN(targetId)) {
      await bot.sendMessage(chatId, '⚠️ ID inválido. Ingrese un número de Chat ID:');
      return;
    }
    session.adminAssignTargetId = targetId;
    session.step                = 'admin_assign_waiting_routes';
    await bot.sendMessage(chatId,
      `🛣️ Ingrese las rutas para el usuario *${targetId}* (separadas por coma),\no escriba *all* para acceso sin restricciones:`,
      { parse_mode: 'Markdown' }
    );

  } else if (session.step === 'admin_assign_waiting_routes') {
    if (!isAdmin(chatId)) {
      session.step = 'idle';
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
      return;
    }
    const routes = text.toLowerCase() === 'all'
      ? []
      : text.split(',').map(r => r.trim()).filter(Boolean);
    db.upsertUser(session.adminAssignTargetId, null, routes);
    db.logAction(chatId, 'admin_assign_routes', { targetId: session.adminAssignTargetId, routes });
    const routeDesc = routes.length === 0 ? 'Sin restricciones' : routes.join(', ');
    session.step = 'idle';
    await bot.sendMessage(chatId,
      `✅ Rutas asignadas al usuario *${session.adminAssignTargetId}*: ${routeDesc}`,
      { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() }
    );

  } else if (session.step === 'admin_template_waiting_name') {
    if (!isAdmin(chatId)) {
      session.step = 'idle';
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
      return;
    }
    session.adminTemplateName = text;
    session.step              = 'admin_template_waiting_planilla';
    await bot.sendMessage(chatId, '💰 Ingrese el monto de *planilla* para esta plantilla (C$):', {
      parse_mode: 'Markdown'
    });

  } else if (session.step === 'admin_template_waiting_planilla') {
    if (!isAdmin(chatId)) {
      session.step = 'idle';
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
      return;
    }
    const amount = parseFloat(text.replace(/,/g, ''));
    if (isNaN(amount) || amount < 0) {
      await bot.sendMessage(chatId, '⚠️ Monto inválido. Ingrese un número positivo:');
      return;
    }
    const id = db.saveRouteTemplate(session.adminTemplateName, amount);
    db.logAction(chatId, 'template_created', { id, name: session.adminTemplateName, planilla: amount });
    session.step = 'idle';
    await bot.sendMessage(chatId,
      `✅ Plantilla *"${session.adminTemplateName}"* guardada (C$${amount.toFixed(2)}).`,
      { parse_mode: 'Markdown', reply_markup: getAdminMenuKeyboard() }
    );

  } else if (session.step === 'admin_template_waiting_del_id') {
    if (!isAdmin(chatId)) {
      session.step = 'idle';
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
      return;
    }
    const id      = parseInt(text, 10);
    if (isNaN(id)) {
      await bot.sendMessage(chatId, '⚠️ ID inválido. Ingrese el número de la plantilla:');
      return;
    }
    const deleted = db.deleteRouteTemplate(id);
    db.logAction(chatId, 'template_deleted', { id });
    session.step = 'idle';
    if (deleted) {
      await bot.sendMessage(chatId, `🗑️ Plantilla #${id} eliminada.`, {
        reply_markup: getAdminMenuKeyboard()
      });
    } else {
      await bot.sendMessage(chatId, `⚠️ Plantilla #${id} no encontrada.`, {
        reply_markup: getAdminMenuKeyboard()
      });
    }

  } else {
    await bot.sendMessage(chatId, '📱 Use /start para iniciar.', {
      reply_markup: getMainMenuKeyboard()
    });
  }
});

console.log('ArqueoFlow bot started ✅');
