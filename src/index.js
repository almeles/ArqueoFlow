'use strict';

const { exec } = require('child_process');
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
  getAdminTerminalKeyboard
} = require('./handlers');
const { generateSummary } = require('./utils');
const db = require('./db');

const TOKEN        = process.env.BOT_TOKEN;
/** Default USD → C$ exchange rate; override via EXCHANGE_RATE env var. */
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
  (process.env.ADMIN_CHAT_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
);

/** @param {number} chatId @returns {boolean} */
function isAdmin(chatId) {
  return ADMIN_CHAT_IDS.has(chatId);
}

/**
 * Execute a shell command on the server and return combined stdout + stderr.
 * Commands are subject to a 10-second timeout and a 512 KB output buffer.
 *
 * @param {string} cmd Shell command to execute.
 * @returns {Promise<string>} Trimmed output text.
 */
function execCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      if (error) {
        reject(Object.assign(new Error(output || error.message), { code: error.code }));
      } else {
        resolve(output);
      }
    });
  });
}

const bot = new TelegramBot(TOKEN, { polling: true });

/** Maximum characters per Telegram message. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Session store (in-memory)
// ---------------------------------------------------------------------------

/** @type {Map<number, Object>} */
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { step: 'idle', arqueo: {} });
  }
  return sessions.get(chatId);
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
  sessions.set(chatId, { step: 'menu', arqueo: {} });
  bot.sendMessage(chatId, 'Bienvenido a *ArqueoFlow* 🧾', {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
});

// ---------------------------------------------------------------------------
// Callback-query handler
// ---------------------------------------------------------------------------

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const data   = query.data;
  const session = getSession(chatId);

  await bot.answerCallbackQuery(query.id);

  // ── Main menu ────────────────────────────────────────────────────────────
  if (data === 'menu_start') {
    session.step  = 'route';
    session.arqueo = {};
    await bot.sendMessage(chatId, '📋 Ingrese el número de ruta:');

  } else if (data === 'menu_history') {
    const history = db.getHistory(chatId);
    const text = history.length
      ? history.map(a => `📄 Ruta ${a.route} | C$${a.total_caja.toFixed(2)} | ${a.status}`).join('\n')
      : 'No hay arqueos registrados.';
    await bot.sendMessage(chatId, text, { reply_markup: getMainMenuKeyboard() });

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
          const emoji = row.status === 'cuadrado' ? '🟢'
            : row.status === 'faltante'  ? '🔴'
            : row.status === 'sobrante'  ? '🟡'
            : row.status === 'aprobado'  ? '✅'
            : row.status === 'rechazado' ? '❌'
            : '⬜';
          text += `${emoji} ${row.status.toUpperCase()}: ${row.count}\n`;
        });
      }
      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: getAdminMenuKeyboard()
      });
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
            + `💰 Total: C$${a.total_caja.toFixed(2)} | Diff: C$${a.diff.toFixed(2)}\n`
            + `📅 ${a.created_at}`;
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
        const statusEmoji = s => s === 'cuadrado' ? '🟢'
          : s === 'faltante'  ? '🔴'
          : s === 'sobrante'  ? '🟡'
          : s === 'aprobado'  ? '✅'
          : s === 'rechazado' ? '❌'
          : '⬜';
        const lines = all.map(a =>
          `${statusEmoji(a.status)} #${a.id} Ruta ${a.route} | C$${a.total_caja.toFixed(2)} | ${a.status}`
        );
        await bot.sendMessage(chatId, `📁 *Últimos arqueos:*\n\n${lines.join('\n')}`, {
          parse_mode: 'Markdown',
          reply_markup: getAdminMenuKeyboard()
        });
      }
    }

  // ── Admin: open terminal ──────────────────────────────────────────────────
  } else if (data === 'admin_terminal') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      session.step = 'terminal';
      await bot.sendMessage(
        chatId,
        '🖥️ *Terminal activo* ⚠️\n\n'
        + '⚠️ *Advertencia de seguridad:* los comandos se ejecutan directamente en el servidor con los permisos del proceso del bot\\. '
        + 'Úsalo únicamente para tareas administrativas de confianza\\.\n\n'
        + 'Envía cualquier comando para ejecutarlo\\. Escribe `exit` o pulsa el botón para salir\\.',
        { parse_mode: 'MarkdownV2', reply_markup: getAdminTerminalKeyboard() }
      );
    }

  // ── Admin: exit terminal ──────────────────────────────────────────────────
  } else if (data === 'admin_terminal_exit') {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      session.step = 'menu';
      await bot.sendMessage(chatId, '🖥️ Terminal cerrado.', { reply_markup: getAdminMenuKeyboard() });
    }

  // ── Admin: approve ────────────────────────────────────────────────────────
  } else if (data.startsWith('admin_approve_')) {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
    } else {
      const id = parseInt(data.slice('admin_approve_'.length), 10);
      const changed = db.updateArqueoStatus(id, 'aprobado');
      if (changed) {
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
      const id = parseInt(data.slice('admin_reject_'.length), 10);
      const changed = db.updateArqueoStatus(id, 'rechazado');
      if (changed) {
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
    session.arqueo.usdCounts = session.arqueo.usdCounts || {};
    session.arqueo.usdCounts[bill] = (session.arqueo.usdCounts[bill] || 0) + 1;
    await bot.editMessageReplyMarkup(getUsdKeyboard(session.arqueo.usdCounts), {
      chat_id: chatId, message_id: msgId
    });

  // ── NIO denomination taps ────────────────────────────────────────────────
  } else if (data.startsWith('nio_')) {
    const denom = parseFloat(data.slice(4));
    session.arqueo.nioCounts = session.arqueo.nioCounts || {};
    session.arqueo.nioCounts[denom] = (session.arqueo.nioCounts[denom] || 0) + 1;
    await bot.editMessageReplyMarkup(getNioKeyboard(session.arqueo.nioCounts), {
      chat_id: chatId, message_id: msgId
    });

  // ── Action: Save ─────────────────────────────────────────────────────────
  } else if (data === 'action_save') {
    if (session.step === 'usd') {
      // Move from USD entry to NIO entry
      const exchRate = session.arqueo.exchangeRate || EXCHANGE_RATE;
      session.arqueo.cashUsd = sumDenoms(USD_BILLS, session.arqueo.usdCounts || {}) * exchRate;
      session.step = 'nio';
      session.arqueo.nioCounts = {};
      await bot.sendMessage(chatId, '🇳🇮 Conteo NIO. Toque cada billete/moneda:', {
        reply_markup: getNioKeyboard({})
      });

    } else if (session.step === 'nio') {
      // Move from NIO entry to summary
      session.arqueo.cashNio = sumDenoms([...NIO_BILLS, ...NIO_COINS], session.arqueo.nioCounts || {});
      session.step = 'summary';
      const summary = generateSummary(session.arqueo);
      await bot.sendMessage(chatId, summary, {
        parse_mode: 'MarkdownV2',
        reply_markup: getActionKeyboard()
      });

    } else if (session.step === 'summary') {
      // Persist to DB
      const id = db.saveArqueo({ chatId, ...session.arqueo });
      sessions.set(chatId, { step: 'menu', arqueo: {} });
      await bot.sendMessage(chatId, `✅ Arqueo #${id} guardado.`, {
        reply_markup: getMainMenuKeyboard()
      });
    }

  // ── Action: Cancel ───────────────────────────────────────────────────────
  } else if (data === 'action_cancel') {
    sessions.set(chatId, { step: 'menu', arqueo: {} });
    await bot.sendMessage(chatId, '❌ Arqueo cancelado.', {
      reply_markup: getMainMenuKeyboard()
    });

  // ── Action: Edit ─────────────────────────────────────────────────────────
  } else if (data === 'action_edit') {
    session.step  = 'route';
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

  if (session.step === 'route') {
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
      session.step = 'usd';
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
    session.step = 'usd';
    session.arqueo.usdCounts  = {};
    await bot.sendMessage(chatId, '🇺🇸 Conteo USD. Toque cada billete para incrementar:', {
      reply_markup: getUsdKeyboard({})
    });

  } else if (session.step === 'terminal') {
    if (!isAdmin(chatId)) {
      session.step = 'menu';
      await bot.sendMessage(chatId, '🚫 Acceso denegado.', { reply_markup: getMainMenuKeyboard() });
      return;
    }
    if (text.toLowerCase() === 'exit') {
      session.step = 'menu';
      await bot.sendMessage(chatId, '🖥️ Terminal cerrado.', { reply_markup: getAdminMenuKeyboard() });
      return;
    }
    let reply;
    try {
      const output = await execCommand(text);
      reply = output || '(sin salida)';
    } catch (err) {
      reply = `⚠️ Error (código ${err.code || '?'}):\n${err.message || String(err)}`;
    }
    if (reply.length > TELEGRAM_MAX_MESSAGE_LENGTH) reply = reply.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH) + '\n…(truncado)';
    await bot.sendMessage(chatId, reply, { reply_markup: getAdminTerminalKeyboard() });

  } else {
    await bot.sendMessage(chatId, '📱 Use /start para iniciar.', {
      reply_markup: getMainMenuKeyboard()
    });
  }
});

console.log('ArqueoFlow bot started ✅');
