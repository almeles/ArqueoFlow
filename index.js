'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { initDB, saveArqueo, getTodayArqueosByUser, getArqueoById, deleteArqueo, getAllArqueos } = require('./db');
const {
  ROUTES,
  calcTotal,
  buildSummary,
  formatArqueoRecord,
  toCSV,
  denominationKeyboard,
  routeKeyboard,
} = require('./utils');

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is not set. Copy .env.example to .env and fill in the token.');
  process.exit(1);
}

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number);

initDB();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── In-memory state ──────────────────────────────────────────────────────────
// State machine per user:
//   idle           – no active session
//   selecting_route – waiting for route button click
//   counting       – denomination entry loop
//   awaiting_qty   – waiting for the user to type a quantity for a chosen denomination

/** @type {Map<number, { step: string, route?: string, counts?: object, denom?: number, msgId?: number }>} */
const userState = new Map();

function getState(userId) {
  if (!userState.has(userId)) userState.set(userId, { step: 'idle' });
  return userState.get(userId);
}

function resetState(userId) {
  userState.set(userId, { step: 'idle' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

/** Send (or edit) the denomination entry screen. */
async function showDenomScreen(chatId, state, editMsgId) {
  const summary = buildSummary(state.counts);
  const text =
    `🚌 *Ruta ${state.route}* – Arqueo en curso\n\n` +
    `Selecciona una denominación para registrar la cantidad:\n\n` +
    summary;

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: denominationKeyboard() },
  };

  if (editMsgId) {
    try {
      const sent = await bot.editMessageText(text, { chat_id: chatId, message_id: editMsgId, ...opts });
      return sent.message_id;
    } catch (_) {
      // If message is not modified or deleted, fall through to send a new one
    }
  }
  const sent = await bot.sendMessage(chatId, text, opts);
  return sent.message_id;
}

/** Main menu keyboard */
function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '💵 Nuevo Arqueo' }],
      [{ text: '📄 Mis Arqueos Hoy' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  resetState(msg.from.id);
  bot.sendMessage(
    chatId,
    '👋 *Bienvenido a ArqueoFlow*\n\nUsa el menú para registrar o consultar arqueos de rutas.',
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '*Comandos disponibles:*\n' +
    '/start – Menú principal\n' +
    '/help  – Esta ayuda\n' +
    '/export – (Admin) Exportar todos los arqueos a CSV',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/export/, async (msg) => {
  const userId = msg.from.id;
  if (!isAdmin(userId)) {
    return bot.sendMessage(msg.chat.id, '⛔ No tienes permiso para usar este comando.');
  }

  const rows = getAllArqueos();
  if (rows.length === 0) {
    return bot.sendMessage(msg.chat.id, 'ℹ️ No hay arqueos registrados aún.');
  }

  const csv = toCSV(rows);
  const buffer = Buffer.from(csv, 'utf8');
  const filename = `arqueos_${new Date().toISOString().slice(0, 10)}.csv`;

  await bot.sendDocument(
    msg.chat.id,
    buffer,
    { caption: `📊 Export: ${rows.length} registros` },
    { filename, contentType: 'text/csv' }
  );
});

// ─── Text messages (menu buttons + quantity input) ────────────────────────────

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  const state = getState(userId);

  // ── Main menu: Nuevo Arqueo
  if (text === '💵 Nuevo Arqueo') {
    resetState(userId);
    const s = getState(userId);
    s.step = 'selecting_route';
    userState.set(userId, s);
    return bot.sendMessage(
      chatId,
      '🚌 Selecciona la ruta para el arqueo:',
      { reply_markup: { inline_keyboard: routeKeyboard() } }
    );
  }

  // ── Main menu: Mis Arqueos Hoy
  if (text === '📄 Mis Arqueos Hoy') {
    const arqueos = getTodayArqueosByUser(userId);
    if (arqueos.length === 0) {
      return bot.sendMessage(chatId, 'ℹ️ No tienes arqueos registrados hoy.');
    }
    for (const arqueo of arqueos) {
      await bot.sendMessage(
        chatId,
        formatArqueoRecord(arqueo),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: `❌ Eliminar #${arqueo.id}`, callback_data: `delete_${arqueo.id}` }]],
          },
        }
      );
    }
    return;
  }

  // ── Quantity input when awaiting a denomination count
  if (state.step === 'awaiting_qty') {
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty < 0) {
      return bot.sendMessage(chatId, '⚠️ Por favor ingresa un número entero válido (≥ 0).');
    }

    if (qty === 0) {
      // Remove denomination if qty is 0
      delete state.counts[String(state.denom)];
    } else {
      state.counts[String(state.denom)] = qty;
    }

    state.step = 'counting';
    const newMsgId = await showDenomScreen(chatId, state, null);
    state.msgId = newMsgId;
    return;
  }
});

// ─── Callback queries (inline buttons) ────────────────────────────────────────

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const state = getState(userId);

  // Always acknowledge the callback
  await bot.answerCallbackQuery(query.id);

  // ── Route selection
  if (data.startsWith('route_')) {
    const route = data.replace('route_', '');
    if (!ROUTES.includes(route)) return;

    state.step = 'counting';
    state.route = route;
    state.counts = {};
    state.msgId = null;

    // Remove the route selection message
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch (_) {}

    const msgId = await showDenomScreen(chatId, state, null);
    state.msgId = msgId;
    return;
  }

  // ── Denomination selected
  if (data.startsWith('denom_') && state.step === 'counting') {
    const denom = parseInt(data.replace('denom_', ''), 10);
    state.step = 'awaiting_qty';
    state.denom = denom;
    return bot.sendMessage(
      chatId,
      `✏️ ¿Cuántos billetes/monedas de *$${denom}* tienes?\n(Escribe el número o 0 para quitar)`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Finish and save
  if (data === 'finish_arqueo' && (state.step === 'counting' || state.step === 'awaiting_qty')) {
    if (!state.route) {
      return bot.sendMessage(chatId, '⚠️ No hay una ruta seleccionada. Empieza un nuevo arqueo.');
    }
    if (Object.keys(state.counts).length === 0) {
      return bot.sendMessage(chatId, '⚠️ No has ingresado ninguna denominación. Agrega al menos una.');
    }

    const total = calcTotal(state.counts);
    const now = new Date();
    const dateStr = now.toISOString().replace('T', ' ').slice(0, 19);
    const username = query.from.username || query.from.first_name || '';

    // Capture values before resetting state
    const savedRoute = state.route;
    const savedCounts = state.counts;

    const id = saveArqueo({
      date: dateStr,
      user_id: userId,
      username,
      route_id: savedRoute,
      total_amount: total,
      denominations: savedCounts,
    });

    // Clean up the denomination screen message
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch (_) {}

    resetState(userId);

    return bot.sendMessage(
      chatId,
      `✅ *Arqueo #${id} guardado*\n\n` +
      `📅 ${dateStr}\n` +
      `🚌 Ruta: ${savedRoute}\n` +
      `💰 Total: $${total.toLocaleString('es-MX')}`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
  }

  // ── Cancel
  if (data === 'cancel_arqueo') {
    resetState(userId);
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch (_) {}
    return bot.sendMessage(chatId, '🚫 Arqueo cancelado.', { reply_markup: mainMenuKeyboard() });
  }

  // ── Delete a record
  if (data.startsWith('delete_')) {
    const arqueoId = parseInt(data.replace('delete_', ''), 10);
    const arqueo = getArqueoById(arqueoId);

    if (!arqueo) {
      return bot.sendMessage(chatId, '⚠️ Arqueo no encontrado.');
    }
    if (arqueo.user_id !== userId && !isAdmin(userId)) {
      return bot.sendMessage(chatId, '⛔ No tienes permiso para eliminar este arqueo.');
    }

    deleteArqueo(arqueoId);
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch (_) {}
    return bot.sendMessage(chatId, `🗑 Arqueo #${arqueoId} eliminado.`);
  }
});

// ─── Error handling ────────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.code, err.message);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

console.log('✅ ArqueoFlow bot is running...');
