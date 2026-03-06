'use strict';

const { getSession, upsertSession, deleteSession } = require('./db');
const { NIO_DENOMINATIONS, fmt, calculateTotal } = require('./utils');

// ── keyboard helpers ──────────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📋 Nueva Sesión' }],
        [{ text: '💵 Contar Efectivo' }, { text: '🔄 Devoluciones' }],
        [{ text: '📊 Resumen' }, { text: '✅ Finalizar' }],
      ],
      resize_keyboard: true,
    },
  };
}

function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}

/**
 * Build a Telegram reply keyboard for selecting NIO denominations.
 * Bills are shown in rows of three; coins (0.50, 0.25, 0.10) occupy a
 * dedicated bottom row so they are easy to tap.
 *
 * @returns {object}  Telegram sendMessage options object.
 */
function getNioKeyboard() {
  const bills = NIO_DENOMINATIONS.filter((d) => d >= 1);
  const coins = NIO_DENOMINATIONS.filter((d) => d < 1);

  // Split bills into rows of three
  const billRows = [];
  for (let i = 0; i < bills.length; i += 3) {
    billRows.push(
      bills.slice(i, i + 3).map((d) => ({ text: `C$ ${fmt(d)}` }))
    );
  }

  // Coins get their own row at the bottom
  const coinRow = coins.map((d) => ({ text: `C$ ${fmt(d)}` }));

  return {
    reply_markup: {
      keyboard: [
        ...billRows,
        coinRow,
        [{ text: '✅ Listo' }],
      ],
      resize_keyboard: true,
    },
  };
}

// ── formatting ────────────────────────────────────────────────────────────────

function buildSummary(session) {
  const monto = Number(session.monto_planilla || 0);
  const counts = session.coin_counts || {};
  const cashTotal = calculateTotal(counts);
  const devCount = session.return_count != null ? session.return_count : 0;
  const devAmount = Number(session.return_amount || 0);
  const neto = monto - devAmount;

  let msg = '📊 *Resumen de Arqueo*\n\n';
  msg += `💰 Monto Planilla: C$ ${fmt(monto)}\n`;

  if (cashTotal > 0) {
    msg += `💵 Efectivo Contado: C$ ${fmt(cashTotal)}\n`;
  }
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

    // ── Contar Efectivo ───────────────────────────────────────────────────────
    if (text === '💵 Contar Efectivo') {
      const session = getSession(chatId);
      if (!session || session.monto_planilla == null) {
        await bot.sendMessage(
          chatId,
          '⚠️ Primero inicie una sesión e ingrese el Monto Planilla.',
          mainMenuKeyboard()
        );
        return;
      }
      upsertSession(chatId, { state: 'counting', current_denom: null });
      await bot.sendMessage(
        chatId,
        '💵 *Contar Efectivo*\n\nSeleccione una denominación:',
        { parse_mode: 'Markdown', ...getNioKeyboard() }
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
        await bot.sendMessage(chatId, '⚠️ No hay sesión activa.', mainMenuKeyboard());
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
      await bot.sendMessage(chatId, 'Use /start para iniciar.', mainMenuKeyboard());
      return;
    }

    switch (session.state) {
      // ── Monto Planilla ────────────────────────────────────────────────────
      case 'awaiting_monto': {
        const monto = parseFloat(text.replace(',', '.'));
        if (isNaN(monto) || monto < 0) {
          await bot.sendMessage(chatId, '⚠️ Ingrese un número válido para el Monto Planilla:');
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

      // ── Cash counting ──────────────────────────────────────────────────────
      case 'counting': {
        // ── "✅ Listo" while in counting state finishes counting ────────────
        if (text === '✅ Listo') {
          const total = calculateTotal(session.coin_counts || {});
          upsertSession(chatId, { state: 'idle', current_denom: null });
          await bot.sendMessage(
            chatId,
            `✅ Conteo finalizado.\n💵 Total efectivo: C$ ${fmt(total)}`,
            mainMenuKeyboard()
          );
          return;
        }

        // ── Denomination button tapped ────────────────────────────────────
        const denomMatch = text.match(/^C\$\s*([\d.]+)$/);
        if (denomMatch) {
          const denom = denomMatch[1];
          // Validate it is a known denomination
          const known = NIO_DENOMINATIONS.some(
            (d) => Math.abs(parseFloat(denom) - d) < 0.001
          );
          if (!known) {
            await bot.sendMessage(chatId, '⚠️ Denominación no reconocida.', getNioKeyboard());
            return;
          }
          upsertSession(chatId, { state: 'counting', current_denom: denom });
          const current = (session.coin_counts || {})[denom] || 0;
          await bot.sendMessage(
            chatId,
            `¿Cuántas ${denom >= 1 ? 'billetes' : 'monedas'} de C$ ${fmt(parseFloat(denom))} tiene? (actual: ${current})`,
            removeKeyboard()
          );
          return;
        }

        // ── Count entry when a denomination is already selected ────────────
        if (session.current_denom) {
          const count = parseInt(text, 10);
          if (isNaN(count) || count < 0) {
            await bot.sendMessage(chatId, '⚠️ Ingrese un número entero válido:');
            return;
          }
          const denom = session.current_denom;
          const updatedCounts = { ...(session.coin_counts || {}), [denom]: count };
          upsertSession(chatId, { state: 'counting', current_denom: null, coin_counts: updatedCounts });
          const total = calculateTotal(updatedCounts);
          await bot.sendMessage(
            chatId,
            `✅ C$ ${fmt(parseFloat(denom))} × ${count} registrado.\n💵 Total parcial: C$ ${fmt(total)}\n\nSeleccione otra denominación o pulse ✅ Listo:`,
            getNioKeyboard()
          );
          return;
        }

        await bot.sendMessage(chatId, 'Seleccione una denominación:', getNioKeyboard());
        break;
      }

      // ── Return count ──────────────────────────────────────────────────────
      case 'awaiting_return_count': {
        const count = parseInt(text, 10);
        if (isNaN(count) || count < 0) {
          await bot.sendMessage(chatId, '⚠️ Ingrese un número entero válido:');
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
          await bot.sendMessage(chatId, '⚠️ Ingrese un monto válido:');
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

module.exports = { registerHandlers, buildSummary, getNioKeyboard };
