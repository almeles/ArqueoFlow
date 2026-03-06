'use strict';

const { getSession, upsertSession, deleteSession } = require('./db');

// ── keyboard helpers ──────────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📋 Nueva Sesión' }],
        [{ text: '🔄 Devoluciones' }, { text: '📊 Resumen' }],
        [{ text: '✅ Finalizar' }],
      ],
      resize_keyboard: true,
    },
  };
}

function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}

// ── formatting ────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toFixed(2);
}

function buildSummary(session) {
  const monto = Number(session.monto_planilla || 0);
  const devCount = session.return_count != null ? session.return_count : 0;
  const devAmount = Number(session.return_amount || 0);
  const neto = monto - devAmount;

  let msg = '📊 *Resumen de Arqueo*\n\n';
  msg += `💰 Monto Planilla: C$ ${fmt(monto)}\n`;
  if (devCount > 0 || devAmount > 0) {
    msg += `🔄 Devoluciones (${devCount}): - C$ ${fmt(devAmount)}\n`;
  }
  msg += `\n✅ *Neto a Entregar: C$ ${fmt(neto)}*`;
  return msg;
}

// ── main handler ──────────────────────────────────────────────────────────────

/**
 * @param {import('node-telegram-bot-api').default} bot
 */
function registerHandlers(bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // ── /start ───────────────────────────────────────────────────────────────
    if (text === '/start') {
      await bot.sendMessage(
        chatId,
        '¡Bienvenido a ArqueoFlow! 👋\nUse el menú para comenzar.',
        mainMenuKeyboard()
      );
      return;
    }

    // ── Nueva Sesión ─────────────────────────────────────────────────────────
    if (text === '📋 Nueva Sesión') {
      deleteSession(chatId);
      upsertSession(chatId, { state: 'awaiting_monto' });
      await bot.sendMessage(
        chatId,
        '📋 *Nueva sesión iniciada.*\n\nIngrese el *Monto Planilla* (C$):',
        { parse_mode: 'Markdown', ...removeKeyboard() }
      );
      return;
    }

    // ── Devoluciones button ───────────────────────────────────────────────────
    if (text === '🔄 Devoluciones') {
      const session = getSession(chatId);
      if (!session || session.monto_planilla == null) {
        await bot.sendMessage(
          chatId,
          '⚠️ Primero inicie una sesión e ingrese el Monto Planilla.',
          mainMenuKeyboard()
        );
        return;
      }
      upsertSession(chatId, { state: 'awaiting_return_count' });
      await bot.sendMessage(
        chatId,
        '🔄 *Devoluciones*\n\n¿Cuántas facturas de devolución trae?',
        { parse_mode: 'Markdown', ...removeKeyboard() }
      );
      return;
    }

    // ── Resumen ───────────────────────────────────────────────────────────────
    if (text === '📊 Resumen') {
      const session = getSession(chatId);
      if (!session || session.monto_planilla == null) {
        await bot.sendMessage(
          chatId,
          '⚠️ No hay sesión activa.',
          mainMenuKeyboard()
        );
        return;
      }
      await bot.sendMessage(chatId, buildSummary(session), {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard(),
      });
      return;
    }

    // ── Finalizar ─────────────────────────────────────────────────────────────
    if (text === '✅ Finalizar') {
      const session = getSession(chatId);
      if (!session || session.monto_planilla == null) {
        await bot.sendMessage(chatId, '⚠️ No hay sesión activa.', mainMenuKeyboard());
        return;
      }
      const summary = buildSummary(session);
      deleteSession(chatId);
      await bot.sendMessage(chatId, `${summary}\n\n_Sesión finalizada._`, {
        parse_mode: 'Markdown',
        ...removeKeyboard(),
      });
      return;
    }

    // ── State-driven inputs ────────────────────────────────────────────────────
    const session = getSession(chatId);
    if (!session) {
      await bot.sendMessage(
        chatId,
        'Use /start para iniciar.',
        mainMenuKeyboard()
      );
      return;
    }

    switch (session.state) {
      // ── Monto Planilla ────────────────────────────────────────────────────
      case 'awaiting_monto': {
        const monto = parseFloat(text.replace(',', '.'));
        if (isNaN(monto) || monto < 0) {
          await bot.sendMessage(
            chatId,
            '⚠️ Ingrese un número válido para el Monto Planilla:'
          );
          return;
        }
        upsertSession(chatId, { state: 'idle', monto_planilla: monto });
        await bot.sendMessage(
          chatId,
          `✅ Monto Planilla registrado: C$ ${fmt(monto)}`,
          mainMenuKeyboard()
        );
        break;
      }

      // ── Return count ──────────────────────────────────────────────────────
      case 'awaiting_return_count': {
        const count = parseInt(text, 10);
        if (isNaN(count) || count < 0) {
          await bot.sendMessage(
            chatId,
            '⚠️ Ingrese un número entero válido:'
          );
          return;
        }
        upsertSession(chatId, { state: 'awaiting_return_amount', return_count: count });
        await bot.sendMessage(
          chatId,
          `Ingrese el *MONTO TOTAL* de estas ${count} devoluciones (C$):`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      // ── Return total amount ────────────────────────────────────────────────
      case 'awaiting_return_amount': {
        const amount = parseFloat(text.replace(',', '.'));
        if (isNaN(amount) || amount < 0) {
          await bot.sendMessage(
            chatId,
            '⚠️ Ingrese un monto válido:'
          );
          return;
        }
        upsertSession(chatId, { state: 'idle', return_amount: amount });
        const updated = getSession(chatId);
        await bot.sendMessage(
          chatId,
          `✅ Devoluciones registradas: ${updated.return_count} factura(s) por C$ ${fmt(amount)}.`,
          mainMenuKeyboard()
        );
        break;
      }

      default:
        await bot.sendMessage(chatId, 'Use el menú.', mainMenuKeyboard());
    }
  });
}

module.exports = { registerHandlers, buildSummary, fmt };
