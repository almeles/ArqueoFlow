'use strict';

const TelegramBot = require('node-telegram-bot-api');
const {
  USD_BILLS,
  NIO_BILLS,
  NIO_COINS,
  getUsdKeyboard,
  getNioKeyboard,
  getMainMenuKeyboard,
  getActionKeyboard
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

const bot = new TelegramBot(TOKEN, { polling: true });

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
    await bot.sendMessage(chatId, '🛡️ Panel de administración (próximamente).', {
      reply_markup: getMainMenuKeyboard()
    });

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

  } else {
    await bot.sendMessage(chatId, '📱 Use /start para iniciar.', {
      reply_markup: getMainMenuKeyboard()
    });
  }
});

console.log('ArqueoFlow bot started ✅');
