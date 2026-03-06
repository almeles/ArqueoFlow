'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  console.error('ERROR: TELEGRAM_TOKEN is not set. Copy .env.example to .env and set your token.');
  process.exit(1);
}

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
);

const bot = new TelegramBot(TOKEN, { polling: true });

// ─── NIO Denominations ────────────────────────────────────────────────────────
// Bills and coins for Córdoba (NIO) — listed from highest to lowest value.
// Each entry has a unique key so they can be stored as JSON in the DB.
const DENOMINATIONS = [
  { key: 'b1000', label: 'Billete C$1,000', value: 1000 },
  { key: 'b500',  label: 'Billete C$500',   value: 500  },
  { key: 'b200',  label: 'Billete C$200',   value: 200  },
  { key: 'b100',  label: 'Billete C$100',   value: 100  },
  { key: 'b50',   label: 'Billete C$50',    value: 50   },
  { key: 'b20',   label: 'Billete C$20',    value: 20   },
  { key: 'b10',   label: 'Billete C$10',    value: 10   },
  { key: 'c10',   label: 'Moneda C$10',     value: 10   },
  { key: 'c5',    label: 'Moneda C$5',      value: 5    },
  { key: 'c1',    label: 'Moneda C$1',      value: 1    },
  { key: 'c050',  label: 'Moneda C$0.50',   value: 0.50 },
  { key: 'c025',  label: 'Moneda C$0.25',   value: 0.25 },
  { key: 'c010',  label: 'Moneda C$0.10',   value: 0.10 },
  { key: 'c005',  label: 'Moneda C$0.05',   value: 0.05 },
];

// ─── State management ─────────────────────────────────────────────────────────
// In-memory conversation state: chatId -> { step, data }
const userStates = new Map();

function getState(chatId) {
  return userStates.get(String(chatId)) || { step: null, data: {} };
}

function setState(chatId, step, data) {
  userStates.set(String(chatId), { step, data: data || {} });
}

function clearState(chatId) {
  userStates.delete(String(chatId));
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatNIO(amount) {
  const abs = Math.abs(amount);
  const formatted = abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `C$${formatted}`;
}

/**
 * Returns the reconciliation status lines for a given diferencia value.
 * @param {number} diferencia  totalArqueado - totalEsperado
 * @returns {string}  Formatted multi-line reconciliation block
 */
function formatReconciliation(totalArqueado, totalEsperado) {
  const diferencia = totalArqueado - totalEsperado;
  let statusLabel;
  if (diferencia < 0)      statusLabel = `❌ FALTANTE: ${formatNIO(Math.abs(diferencia))}`;
  else if (diferencia > 0) statusLabel = `⚠️ SOBRANTE: ${formatNIO(diferencia)}`;
  else                     statusLabel = '✅ CUADRADO';

  return (
    `🎯 *Total Esperado: ${formatNIO(totalEsperado)}*\n` +
    `📊 *Diferencia: ${diferencia < 0 ? '-' : ''}${formatNIO(Math.abs(diferencia))}*\n` +
    `\n${statusLabel}`
  );
}

// ─── Reply keyboards ──────────────────────────────────────────────────────────

function adminMenuOpts() {
  return {
    reply_markup: {
      keyboard: [
        ['👥 Gestionar Usuarios', '🛣️ Gestionar Rutas'],
        ['💱 Tasas de Cambio',    '💰 Fijar Monto Liquidación'],
        ['📊 Ver Arqueos Recientes'],
      ],
      resize_keyboard: true,
    },
  };
}

function userMenuOpts() {
  return {
    reply_markup: {
      keyboard: [
        ['🧮 Iniciar Arqueo'],
        ['📋 Ver Último Resumen'],
      ],
      resize_keyboard: true,
    },
  };
}

function cancelOpts() {
  return {
    reply_markup: {
      keyboard: [['❌ Cancelar']],
      resize_keyboard: true,
    },
  };
}

function menuOptsForUser(user) {
  return user && user.role === 'admin' ? adminMenuOpts() : userMenuOpts();
}

// ─── /start command ───────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from.id);
  const username  = msg.from.username  || '';
  const firstName = msg.from.first_name || 'Usuario';

  clearState(chatId);

  let user = db.getUser(telegramId);

  if (!user) {
    const role = ADMIN_IDS.has(telegramId) ? 'admin' : 'pending';
    db.createUser(telegramId, username, firstName, role);
    user = db.getUser(telegramId);

    if (role === 'admin') {
      bot.sendMessage(
        chatId,
        `👋 Bienvenido, *${firstName}*!\n\nTienes acceso de *Administrador*. ¿Qué deseas hacer?`,
        { parse_mode: 'Markdown', ...adminMenuOpts() }
      );
    } else {
      bot.sendMessage(
        chatId,
        `👋 Hola, *${firstName}*!\n\nTu cuenta está *pendiente de aprobación* por un administrador. Te notificaremos cuando sea aprobada.`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (user.role === 'admin') {
    bot.sendMessage(
      chatId,
      `👋 Bienvenido de nuevo, *${firstName}*! ¿Qué deseas hacer?`,
      { parse_mode: 'Markdown', ...adminMenuOpts() }
    );
  } else if (user.role === 'user') {
    bot.sendMessage(
      chatId,
      `👋 Hola, *${firstName}*! ¿Qué deseas hacer?`,
      { parse_mode: 'Markdown', ...userMenuOpts() }
    );
  } else {
    bot.sendMessage(
      chatId,
      `⏳ Tu cuenta aún está *pendiente de aprobación*. Contacta a un administrador.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ─── Main message handler ─────────────────────────────────────────────────────

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId    = msg.chat.id;
  const telegramId = String(msg.from.id);
  const text      = msg.text.trim();

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (text === '❌ Cancelar') {
    clearState(chatId);
    const user = db.getUser(telegramId);
    bot.sendMessage(chatId, 'Operación cancelada.', menuOptsForUser(user));
    return;
  }

  const user = db.getUser(telegramId);
  if (!user) {
    bot.sendMessage(chatId, 'Usa /start para registrarte.');
    return;
  }

  // ── Admin menu buttons ────────────────────────────────────────────────────
  if (user.role === 'admin') {
    if (text === '👥 Gestionar Usuarios') {
      clearState(chatId);
      handleAdminUsers(chatId);
      return;
    }
    if (text === '🛣️ Gestionar Rutas') {
      clearState(chatId);
      handleAdminRoutes(chatId);
      return;
    }
    if (text === '💱 Tasas de Cambio') {
      clearState(chatId);
      handleCurrencyRates(chatId);
      return;
    }
    if (text === '💰 Fijar Monto Liquidación') {
      clearState(chatId);
      handleSetTarget(chatId);
      return;
    }
    if (text === '📊 Ver Arqueos Recientes') {
      clearState(chatId);
      handleViewArqueos(chatId);
      return;
    }
  }

  // ── User menu buttons ─────────────────────────────────────────────────────
  if (user.role === 'user') {
    if (text === '🧮 Iniciar Arqueo') {
      clearState(chatId);
      startArqueo(chatId, telegramId);
      return;
    }
    if (text === '📋 Ver Último Resumen') {
      clearState(chatId);
      viewLastArqueo(chatId, telegramId);
      return;
    }
  }

  // ── Conversation state handler ────────────────────────────────────────────
  const state = getState(chatId);
  if (state.step) {
    handleConversationStep(chatId, telegramId, text, state, user);
    return;
  }

  // Fallback: user is not in a conversation and didn't press a known button
  if (user.role === 'pending') {
    bot.sendMessage(chatId, '⏳ Tu cuenta está pendiente de aprobación.');
  } else {
    bot.sendMessage(chatId, '¿Qué deseas hacer?', menuOptsForUser(user));
  }
});

// ─── Conversation state machine ───────────────────────────────────────────────

function handleConversationStep(chatId, telegramId, text, state, user) {
  switch (state.step) {

    // ── Admin: new route name ────────────────────────────────────────────────
    case 'admin_new_route': {
      if (!text || text.length < 2) {
        bot.sendMessage(chatId, '❌ Nombre inválido. Debe tener al menos 2 caracteres.', cancelOpts());
        return;
      }
      db.createRoute(text);
      clearState(chatId);
      bot.sendMessage(
        chatId,
        `✅ Ruta *${text}* creada exitosamente.`,
        { parse_mode: 'Markdown', ...adminMenuOpts() }
      );
      break;
    }

    // ── Admin: currency rate — code ──────────────────────────────────────────
    case 'admin_rate_code': {
      const code = text.toUpperCase().trim();
      if (!/^[A-Z]{3}$/.test(code)) {
        bot.sendMessage(chatId, '❌ Código inválido. Usa 3 letras (ej: USD, EUR).', cancelOpts());
        return;
      }
      setState(chatId, 'admin_rate_value', { code });
      bot.sendMessage(
        chatId,
        `Ingresa cuántos Córdobas (C$) equivale *1 ${code}*:\n_Ej: 36.50_`,
        { parse_mode: 'Markdown', ...cancelOpts() }
      );
      break;
    }

    // ── Admin: currency rate — value ─────────────────────────────────────────
    case 'admin_rate_value': {
      const rate = parseFloat(text.replace(',', '.'));
      if (isNaN(rate) || rate <= 0) {
        bot.sendMessage(chatId, '❌ Tasa inválida. Ingresa un número positivo (ej: 36.50).', cancelOpts());
        return;
      }
      const { code } = state.data;
      db.upsertCurrencyRate(code, rate);
      clearState(chatId);
      bot.sendMessage(
        chatId,
        `✅ Tasa actualizada:\n*1 ${code}* = *${formatNIO(rate)}*`,
        { parse_mode: 'Markdown', ...adminMenuOpts() }
      );
      break;
    }

    // ── Admin: daily target — amount ─────────────────────────────────────────
    case 'admin_target_amount': {
      const amount = parseFloat(text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, '❌ Monto inválido. Ingresa un número positivo (ej: 5000.50).', cancelOpts());
        return;
      }
      const { routeId, routeName } = state.data;
      db.saveDailyTarget(today(), routeId, amount);
      clearState(chatId);
      bot.sendMessage(
        chatId,
        `✅ Monto de liquidación fijado:\n🛣️ Ruta: *${routeName}*\n📅 Fecha: *${today()}*\n💰 Monto: *${formatNIO(amount)}*`,
        { parse_mode: 'Markdown', ...adminMenuOpts() }
      );
      break;
    }

    // ── User: arqueo — denomination count ────────────────────────────────────
    case 'user_arqueo_denom': {
      const qty = parseFloat(text.replace(',', '.'));
      if (isNaN(qty) || qty < 0) {
        bot.sendMessage(chatId, '❌ Cantidad inválida. Ingresa un número mayor o igual a 0.', cancelOpts());
        return;
      }

      const { index, counts, routeId, routeName } = state.data;
      counts[index] = qty;
      const nextIndex = index + 1;

      if (nextIndex < DENOMINATIONS.length) {
        setState(chatId, 'user_arqueo_denom', { ...state.data, index: nextIndex, counts });
        const denom = DENOMINATIONS[nextIndex];
        bot.sendMessage(
          chatId,
          `¿Cuántos/as *${denom.label}* tiene? _(0 si no tiene)_`,
          { parse_mode: 'Markdown', ...cancelOpts() }
        );
      } else {
        // All NIO denominations entered — ask about foreign currency
        const rates = db.getCurrencyRates();
        if (rates.length > 0) {
          const ratesList = rates.map((r) => `• 1 ${r.currency_code} = ${formatNIO(r.rate_to_nio)}`).join('\n');
          const buttons = rates.map((r) => [{ text: r.currency_code, callback_data: `arqueo_forex_${r.currency_code}` }]);
          buttons.push([{ text: '✅ No, solo NIO', callback_data: 'arqueo_forex_skip' }]);

          setState(chatId, 'user_arqueo_forex', { ...state.data, counts, forexAmounts: {} });
          bot.sendMessage(
            chatId,
            `¿Desea agregar moneda extranjera al arqueo?\n\n_Tasas actuales:_\n${ratesList}`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
          );
        } else {
          finishArqueo(chatId, telegramId, { ...state.data, counts, forexAmounts: {} });
        }
      }
      break;
    }

    // ── User: arqueo — forex amount ──────────────────────────────────────────
    case 'user_arqueo_forex_amount': {
      const amount = parseFloat(text.replace(',', '.'));
      if (isNaN(amount) || amount < 0) {
        bot.sendMessage(chatId, '❌ Monto inválido. Ingresa un número mayor o igual a 0.', cancelOpts());
        return;
      }

      const { forexCode } = state.data;
      const forexAmounts = { ...(state.data.forexAmounts || {}), [forexCode]: amount };

      // Ask if there are more currencies to add (excluding those already entered)
      const remaining = db.getCurrencyRates().filter((r) => forexAmounts[r.currency_code] === undefined);
      const newData = { ...state.data, forexAmounts };

      if (remaining.length > 0) {
        setState(chatId, 'user_arqueo_forex', newData);
        const buttons = remaining.map((r) => [{ text: r.currency_code, callback_data: `arqueo_forex_${r.currency_code}` }]);
        buttons.push([{ text: '✅ Finalizar', callback_data: 'arqueo_forex_skip' }]);
        bot.sendMessage(
          chatId,
          '¿Desea agregar otra moneda extranjera?',
          { reply_markup: { inline_keyboard: buttons } }
        );
      } else {
        finishArqueo(chatId, telegramId, newData);
      }
      break;
    }

    // ── User: arqueo — waiting for inline button (forex selection) ───────────
    case 'user_arqueo_forex': {
      bot.sendMessage(chatId, 'Por favor selecciona una opción del menú de botones.');
      break;
    }

    default: {
      clearState(chatId);
      bot.sendMessage(chatId, '¿Qué deseas hacer?', menuOptsForUser(user));
    }
  }
}

// ─── Callback query handler ───────────────────────────────────────────────────

bot.on('callback_query', (query) => {
  const chatId    = query.message.chat.id;
  const telegramId = String(query.from.id);
  const data      = query.data;

  bot.answerCallbackQuery(query.id);

  const user = db.getUser(telegramId);
  if (!user) return;

  // ── Admin: approve / reject pending user ──────────────────────────────────
  if (data.startsWith('approve_user_')) {
    const targetId = data.slice('approve_user_'.length);
    db.updateUserRole(targetId, 'user');
    bot.editMessageText('✅ Usuario aprobado.', {
      chat_id: chatId, message_id: query.message.message_id,
    });
    bot.sendMessage(targetId, '🎉 ¡Tu cuenta ha sido *aprobada*! Usa /start para comenzar.', { parse_mode: 'Markdown' });
    return;
  }

  if (data.startsWith('reject_user_')) {
    const targetId = data.slice('reject_user_'.length);
    db.updateUserRole(targetId, 'rejected');
    bot.editMessageText('❌ Usuario rechazado.', {
      chat_id: chatId, message_id: query.message.message_id,
    });
    return;
  }

  // ── Admin: show route selection to assign to a user ───────────────────────
  if (data.startsWith('assign_route_user_')) {
    const targetUserId = data.slice('assign_route_user_'.length);
    const routes = db.getRoutes();
    if (routes.length === 0) {
      bot.sendMessage(chatId, '⚠️ No hay rutas disponibles. Crea una primero.');
      return;
    }
    const buttons = routes.map((r) => [{
      text: r.name,
      callback_data: `do_assign_route_${targetUserId}_${r.id}`,
    }]);
    bot.sendMessage(chatId, 'Selecciona la ruta a asignar:', {
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  // ── Admin: execute route assignment ───────────────────────────────────────
  if (data.startsWith('do_assign_route_')) {
    // Format: do_assign_route_{telegramId}_{routeId}
    // telegramId is always a numeric string; routeId is the last segment.
    const rest     = data.slice('do_assign_route_'.length);
    const lastUnderscore = rest.lastIndexOf('_');
    const targetUserId = rest.slice(0, lastUnderscore);
    const routeId  = parseInt(rest.slice(lastUnderscore + 1), 10);
    db.updateUserRoute(targetUserId, routeId);
    const route = db.getRoutes().find((r) => r.id === routeId);
    bot.editMessageText(
      `✅ Ruta *${route ? route.name : routeId}* asignada.`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Admin: select route for daily target ──────────────────────────────────
  if (data.startsWith('target_route_')) {
    const routeId = parseInt(data.slice('target_route_'.length), 10);
    const route   = db.getRoutes().find((r) => r.id === routeId);
    if (!route) return;

    setState(chatId, 'admin_target_amount', { routeId, routeName: route.name });
    bot.editMessageText(
      `✅ Ruta seleccionada: *${route.name}*`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );
    bot.sendMessage(
      chatId,
      `💰 Ingresa el monto a liquidar para la ruta *${route.name}* hoy (*${today()}*) en Córdobas:\n_Ej: 5000.50_`,
      { parse_mode: 'Markdown', ...cancelOpts() }
    );
    return;
  }

  // ── User: select route for arqueo ─────────────────────────────────────────
  if (data.startsWith('arqueo_route_')) {
    const routeId = parseInt(data.slice('arqueo_route_'.length), 10);
    const route   = db.getRoutes().find((r) => r.id === routeId);
    if (!route) return;

    bot.editMessageText(
      `✅ Ruta seleccionada: *${route.name}*`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );
    db.updateUserRoute(telegramId, routeId);
    startArqueoDenominations(chatId, routeId, route.name);
    return;
  }

  // ── User: skip foreign currency ───────────────────────────────────────────
  if (data === 'arqueo_forex_skip') {
    const state = getState(chatId);
    bot.editMessageText('✅ Sin moneda extranjera.', {
      chat_id: chatId, message_id: query.message.message_id,
    });
    finishArqueo(chatId, telegramId, { ...state.data, forexAmounts: state.data.forexAmounts || {} });
    return;
  }

  // ── User: add foreign currency amount ────────────────────────────────────
  if (data.startsWith('arqueo_forex_')) {
    const forexCode = data.slice('arqueo_forex_'.length);
    const state     = getState(chatId);
    setState(chatId, 'user_arqueo_forex_amount', { ...state.data, forexCode });
    bot.editMessageText(
      `💱 Ingresa el monto en *${forexCode}*:`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );
    bot.sendMessage(chatId, `Escribe el monto en ${forexCode}:`, cancelOpts());
    return;
  }
});

// ─── Admin handlers ───────────────────────────────────────────────────────────

function handleAdminUsers(chatId) {
  const pending     = db.getPendingUsers();
  const activeUsers = db.getAllUsers().filter((u) => u.role === 'user');

  if (pending.length > 0) {
    let msg = `📋 *Pendientes de aprobación (${pending.length}):*\n\n`;
    const buttons = [];
    pending.forEach((u) => {
      const name = u.first_name || u.username || u.telegram_id;
      msg += `• ${name}${u.username ? ` (@${u.username})` : ''}\n`;
      buttons.push([
        { text: `✅ Aprobar ${name}`,  callback_data: `approve_user_${u.telegram_id}` },
        { text: `❌ Rechazar`,         callback_data: `reject_user_${u.telegram_id}`  },
      ]);
    });
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
  } else {
    bot.sendMessage(chatId, '✅ No hay usuarios pendientes de aprobación.', adminMenuOpts());
  }

  if (activeUsers.length > 0) {
    let msg = '👤 *Usuarios activos:*\n\n';
    const buttons = [];
    const routes = db.getRoutes();
    activeUsers.forEach((u) => {
      const name      = u.first_name || u.username || u.telegram_id;
      const route     = u.route_id ? routes.find((r) => r.id === u.route_id) : null;
      const routeName = route ? route.name : '_(sin ruta)_';
      msg += `• ${name} → 🛣️ ${routeName}\n`;
      buttons.push([{ text: `📍 Asignar ruta a ${name}`, callback_data: `assign_route_user_${u.telegram_id}` }]);
    });
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
  }
}

function handleAdminRoutes(chatId) {
  const routes = db.getRoutes();
  let msg = '🛣️ *Gestión de Rutas*\n\n';

  if (routes.length > 0) {
    routes.forEach((r) => { msg += `• *${r.name}* (ID: ${r.id})\n`; });
  } else {
    msg += '_No hay rutas registradas._\n';
  }

  msg += '\nIngresa el nombre de la *nueva ruta*:';
  setState(chatId, 'admin_new_route', {});
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...cancelOpts() });
}

function handleCurrencyRates(chatId) {
  const rates = db.getCurrencyRates();
  let msg = '💱 *Tasas de Cambio*\n\n';

  if (rates.length > 0) {
    rates.forEach((r) => { msg += `• 1 *${r.currency_code}* = ${formatNIO(r.rate_to_nio)}\n`; });
  } else {
    msg += '_No hay tasas configuradas._\n';
  }

  msg += '\nIngresa el *código* de la moneda a agregar/actualizar (ej: USD, EUR):';
  setState(chatId, 'admin_rate_code', {});
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...cancelOpts() });
}

function handleSetTarget(chatId) {
  const routes = db.getRoutes();

  if (routes.length === 0) {
    bot.sendMessage(chatId, '⚠️ No hay rutas disponibles. Crea una ruta primero.', adminMenuOpts());
    return;
  }

  const todayStr = today();
  const buttons  = routes.map((r) => {
    const existing = db.getDailyTarget(todayStr, r.id);
    const label    = existing
      ? `${r.name}  (actual: ${formatNIO(existing.target_amount)})`
      : r.name;
    return [{ text: label, callback_data: `target_route_${r.id}` }];
  });

  bot.sendMessage(
    chatId,
    `💰 *Fijar Monto de Liquidación*\n\nSelecciona la ruta para hoy (*${todayStr}*):`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

function handleViewArqueos(chatId) {
  const arqueos = db.getRecentArqueos(10);

  if (arqueos.length === 0) {
    bot.sendMessage(chatId, '📊 No hay arqueos registrados.', adminMenuOpts());
    return;
  }

  let msg = '📊 *Arqueos Recientes*\n\n';
  arqueos.forEach((a) => {
    const target = db.getDailyTarget(a.date, a.route_id);
    const diff   = target !== null ? a.total_nio - target.target_amount : null;
    let status   = '';
    if (diff !== null) {
      if (diff < 0)      status = `❌ FALTANTE ${formatNIO(Math.abs(diff))}`;
      else if (diff > 0) status = `⚠️ SOBRANTE ${formatNIO(diff)}`;
      else               status = '✅ CUADRADO';
    }
    const userName  = a.user_name || a.user_username || a.user_id;
    const routeName = a.route_name || a.route_id;
    msg += `• *${a.date}* | ${routeName} | ${userName}\n`;
    msg += `  💵 ${formatNIO(a.total_nio)}${status ? `  ${status}` : ''}\n`;
  });

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...adminMenuOpts() });
}

// ─── Arqueo flow ──────────────────────────────────────────────────────────────

function startArqueo(chatId, telegramId) {
  const user = db.getUser(telegramId);

  if (user.route_id) {
    const route = db.getRoutes().find((r) => r.id === user.route_id);
    if (route) {
      startArqueoDenominations(chatId, route.id, route.name);
      return;
    }
  }

  const routes = db.getRoutes();
  if (routes.length === 0) {
    bot.sendMessage(chatId, '⚠️ No hay rutas disponibles. Contacta al administrador.');
    return;
  }

  const buttons = routes.map((r) => [{ text: r.name, callback_data: `arqueo_route_${r.id}` }]);
  bot.sendMessage(chatId, '🛣️ Selecciona tu ruta:', { reply_markup: { inline_keyboard: buttons } });
}

function startArqueoDenominations(chatId, routeId, routeName) {
  const counts = new Array(DENOMINATIONS.length).fill(0);
  setState(chatId, 'user_arqueo_denom', { routeId, routeName, index: 0, counts });

  bot.sendMessage(
    chatId,
    `🧮 *Arqueo — Ruta: ${routeName}*\n\nIngresa la cantidad de cada denominación.\nEscribe *0* si no tienes esa denominación.\n\n*${DENOMINATIONS[0].label}:*`,
    { parse_mode: 'Markdown', ...cancelOpts() }
  );
}

function finishArqueo(chatId, telegramId, data) {
  clearState(chatId);

  const { routeId, routeName, counts, forexAmounts = {} } = data;

  // ── Calculate NIO total from denominations ────────────────────────────────
  let totalFromDenominations = 0;
  const denomDetails = [];
  DENOMINATIONS.forEach((d, i) => {
    const qty = counts[i] || 0;
    if (qty > 0) {
      const subtotal = qty * d.value;
      totalFromDenominations += subtotal;
      denomDetails.push({ label: d.label, qty, subtotal });
    }
  });

  // ── Convert foreign currency to NIO ───────────────────────────────────────
  let totalFromForex = 0;
  const forexDetails = [];
  const rates = db.getCurrencyRates();
  for (const [code, amount] of Object.entries(forexAmounts)) {
    if (amount <= 0) continue;
    const rate = rates.find((r) => r.currency_code === code);
    if (rate) {
      const nioEquivalent = amount * rate.rate_to_nio;
      totalFromForex += nioEquivalent;
      forexDetails.push({ code, amount, rateToNio: rate.rate_to_nio, nioEquivalent });
    }
  }

  const totalArqueado = totalFromDenominations + totalFromForex;

  // ── Fetch daily target ────────────────────────────────────────────────────
  const todayStr       = today();
  const targetRecord   = db.getDailyTarget(todayStr, routeId);
  const totalEsperado  = targetRecord ? targetRecord.target_amount : null;

  // ── Build summary message ─────────────────────────────────────────────────
  let msg = `📋 *RESUMEN DE ARQUEO*\n`;
  msg += `📅 Fecha: *${todayStr}*\n`;
  msg += `🛣️ Ruta: *${routeName}*\n\n`;

  if (denomDetails.length > 0) {
    msg += `*Billetes y Monedas (NIO):*\n`;
    denomDetails.forEach((d) => {
      msg += `  ${d.label} × ${d.qty} = ${formatNIO(d.subtotal)}\n`;
    });
    msg += `  _Subtotal NIO: ${formatNIO(totalFromDenominations)}_\n\n`;
  } else {
    msg += `  _(ninguna denominación ingresada)_\n\n`;
  }

  if (forexDetails.length > 0) {
    msg += `*Moneda Extranjera:*\n`;
    forexDetails.forEach((f) => {
      msg += `  ${f.code} ${f.amount.toFixed(2)} × ${formatNIO(f.rateToNio)} = ${formatNIO(f.nioEquivalent)}\n`;
    });
    msg += `  _Subtotal Forex: ${formatNIO(totalFromForex)}_\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💵 *Total Arqueado: ${formatNIO(totalArqueado)}*\n`;

  if (totalEsperado !== null) {
    msg += formatReconciliation(totalArqueado, totalEsperado);
  } else {
    msg += `\n_⚠️ No hay monto objetivo fijado para hoy en esta ruta._`;
  }

  // ── Persist arqueo ────────────────────────────────────────────────────────
  const dbUser = db.getUser(telegramId);
  if (dbUser) {
    const denominationsJson = JSON.stringify(
      DENOMINATIONS.reduce((acc, d, i) => { acc[d.key] = counts[i] || 0; return acc; }, {})
    );
    db.saveArqueo(dbUser.id, routeId, todayStr, denominationsJson, totalArqueado);
  }

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...userMenuOpts() });
}

function viewLastArqueo(chatId, telegramId) {
  const user = db.getUser(telegramId);
  if (!user) return;

  const arqueo = db.getLastArqueo(user.id);
  if (!arqueo) {
    bot.sendMessage(chatId, '📋 No tienes arqueos registrados.', userMenuOpts());
    return;
  }

  const target       = db.getDailyTarget(arqueo.date, arqueo.route_id);
  const totalEsperado = target ? target.target_amount : null;

  let msg = `📋 *ÚLTIMO ARQUEO*\n`;
  msg += `📅 Fecha: *${arqueo.date}*\n`;
  msg += `🛣️ Ruta: *${arqueo.route_name || arqueo.route_id}*\n\n`;
  msg += `💵 *Total Arqueado: ${formatNIO(arqueo.total_nio)}*\n`;

  if (totalEsperado !== null) {
    msg += formatReconciliation(arqueo.total_nio, totalEsperado);
  } else {
    msg += `\n_⚠️ No hay monto objetivo fijado para esa fecha en esta ruta._`;
  }

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...userMenuOpts() });
}

console.log('✅ ArqueoFlow bot started and polling for messages…');
