'use strict';

const { Telegraf } = require('telegraf');
const { saveReport } = require('./db');
const {
  DENOMINATIONS,
  formatCurrency,
  formatDenomination,
  calcMontoEsperado,
  calcTotalEfectivo,
  buildReconciliationMessage,
} = require('./utils');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN environment variable is required.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---------------------------------------------------------------------------
// Session store (in-memory, keyed by chat ID)
// ---------------------------------------------------------------------------
const sessions = {};

/**
 * Session states:
 *   IDLE                      - no active arqueo
 *   AWAITING_PLANILLA_ID      - waiting for 6-digit planilla ID
 *   AWAITING_MONTO_PLANILLA   - waiting for planilla amount (NIO)
 *   AWAITING_RUTA             - waiting for route selection
 *   ARQUEO_MENU               - main arqueo menu
 *   AWAITING_DEVOLUCION_COUNT - waiting for number of returns
 *   AWAITING_DEVOLUCION_MONTO - waiting for each return amount (loops N times)
 *   COUNTING_DENOMINATION     - iterating through denominations for cash count
 *   ARQUEO_DONE               - reconciliation complete
 */

/**
 * Available routes (can be extended or moved to DB/config in the future).
 */
const ROUTES = ['Ruta 1', 'Ruta 2', 'Ruta 3', 'Ruta 4', 'Ruta 5'];

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { state: 'IDLE' };
  }
  return sessions[chatId];
}

function resetSession(chatId) {
  sessions[chatId] = { state: 'IDLE' };
}

// ---------------------------------------------------------------------------
// Keyboard helpers
// ---------------------------------------------------------------------------

function routeKeyboard() {
  const buttons = ROUTES.map((route) => [{ text: route }]);
  return { keyboard: buttons, resize_keyboard: true, one_time_keyboard: true };
}

function arqueoMenuKeyboard() {
  return {
    keyboard: [
      ['🔄 Devoluciones'],
      ['💰 Iniciar Conteo de Efectivo'],
      ['❌ Cancelar Arqueo'],
    ],
    resize_keyboard: true,
  };
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

async function sendArqueoMenu(ctx, session) {
  const totalDevoluciones = session.devoluciones.reduce((sum, monto) => sum + monto, 0);
  const montoEsperado = calcMontoEsperado(session.montoPlanilla, session.devoluciones);

  let msg = `📋 *Arqueo en Progreso*\n\n`;
  msg += `Planilla: #${session.planillaId}\n`;
  msg += `Ruta: ${session.ruta}\n`;
  msg += `Monto Planilla: ${formatCurrency(session.montoPlanilla)}\n`;

  if (session.devoluciones.length > 0) {
    msg += `\n*Devoluciones (${session.devoluciones.length}):* ${formatCurrency(totalDevoluciones)}\n`;
  }

  msg += `\n*A Entregar (Neto): ${formatCurrency(montoEsperado)}*\n\n`;
  msg += `¿Qué deseas hacer?`;

  session.state = 'ARQUEO_MENU';

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: arqueoMenuKeyboard(),
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  resetSession(chatId);

  await ctx.reply(
    '👋 Bienvenido a *ArqueoFlow*\n\nSistema de Arqueo de Caja\n\nUsa /arqueo para iniciar un nuevo arqueo.',
    { parse_mode: 'Markdown', reply_markup: removeKeyboard() }
  );
});

bot.command('arqueo', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);

  if (session.state !== 'IDLE' && session.state !== 'ARQUEO_DONE') {
    await ctx.reply('⚠️ Ya hay un arqueo en progreso. Usa /cancelar para cancelarlo primero.');
    return;
  }

  resetSession(chatId);
  sessions[chatId].state = 'AWAITING_PLANILLA_ID';

  await ctx.reply(
    '📋 *Nuevo Arqueo*\n\nPaso 1 de 3: Ingresa el *ID de Planilla* (6 dígitos):',
    { parse_mode: 'Markdown', reply_markup: removeKeyboard() }
  );
});

bot.command('cancelar', async (ctx) => {
  const chatId = ctx.chat.id;
  resetSession(chatId);
  await ctx.reply('✅ Arqueo cancelado.', { reply_markup: removeKeyboard() });
});

// ---------------------------------------------------------------------------
// Message handler — state machine
// ---------------------------------------------------------------------------

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const text = ctx.message.text.trim();

  // Let command handlers deal with commands
  if (text.startsWith('/')) return;

  switch (session.state) {
    // -----------------------------------------------------------------------
    case 'AWAITING_PLANILLA_ID': {
      if (!/^\d{6}$/.test(text)) {
        await ctx.reply('⚠️ El ID de Planilla debe ser exactamente *6 dígitos*. Intenta de nuevo:', {
          parse_mode: 'Markdown',
        });
        return;
      }
      session.planillaId = text;
      session.state = 'AWAITING_MONTO_PLANILLA';

      await ctx.reply(
        `✅ Planilla ID: *${text}*\n\nPaso 2 de 3: Ingresa el *Monto Planilla* (valor en C$):\n_Ejemplo: 10500 o 10500.50_`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    // -----------------------------------------------------------------------
    case 'AWAITING_MONTO_PLANILLA': {
      const amount = parseFloat(text.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('⚠️ Ingresa un monto válido (número positivo). Ejemplo: *10500*', {
          parse_mode: 'Markdown',
        });
        return;
      }
      session.montoPlanilla = amount;
      session.devoluciones = [];
      session.state = 'AWAITING_RUTA';

      await ctx.reply(
        `✅ Monto Planilla: *${formatCurrency(amount)}*\n\nPaso 3 de 3: Selecciona la *Ruta*:`,
        { parse_mode: 'Markdown', reply_markup: routeKeyboard() }
      );
      break;
    }

    // -----------------------------------------------------------------------
    case 'AWAITING_RUTA': {
      if (!ROUTES.includes(text)) {
        await ctx.reply('⚠️ Selecciona una ruta válida del teclado.');
        return;
      }
      session.ruta = text;
      await sendArqueoMenu(ctx, session);
      break;
    }

    // -----------------------------------------------------------------------
    case 'ARQUEO_MENU': {
      if (text === '🔄 Devoluciones') {
        session.state = 'AWAITING_DEVOLUCION_COUNT';
        await ctx.reply(
          '🔄 *Devoluciones*\n\n¿Cuántas facturas de devolución trae hoy?',
          { parse_mode: 'Markdown', reply_markup: removeKeyboard() }
        );
      } else if (text === '💰 Iniciar Conteo de Efectivo') {
        session.denominaciones = {};
        session.denominationIndex = 0;
        session.state = 'COUNTING_DENOMINATION';

        await ctx.reply(
          `💰 *Conteo de Efectivo*\n\nIngresa la cantidad de billetes/monedas de *${formatDenomination(DENOMINATIONS[0])}*:\n_Escribe 0 si no tienes._`,
          { parse_mode: 'Markdown', reply_markup: removeKeyboard() }
        );
      } else if (text === '❌ Cancelar Arqueo') {
        resetSession(chatId);
        await ctx.reply('✅ Arqueo cancelado.', { reply_markup: removeKeyboard() });
      } else {
        await ctx.reply('⚠️ Usa los botones del menú para continuar.');
      }
      break;
    }

    // -----------------------------------------------------------------------
    case 'AWAITING_DEVOLUCION_COUNT': {
      const count = parseInt(text, 10);
      if (isNaN(count) || count <= 0 || !Number.isInteger(count)) {
        await ctx.reply('⚠️ Ingresa un número entero positivo. Ejemplo: *3*', {
          parse_mode: 'Markdown',
        });
        return;
      }
      session.devolucionCount = count;
      session.devolucionIndex = 0;
      session.devoluciones = [];
      session.state = 'AWAITING_DEVOLUCION_MONTO';

      await ctx.reply(
        `Ingresa el monto en C$ de la devolución #1:`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    // -----------------------------------------------------------------------
    case 'AWAITING_DEVOLUCION_MONTO': {
      const amount = parseFloat(text.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('⚠️ Ingresa un monto válido (número positivo). Ejemplo: *500*', {
          parse_mode: 'Markdown',
        });
        return;
      }

      session.devoluciones.push(amount);
      session.devolucionIndex++;

      if (session.devolucionIndex < session.devolucionCount) {
        await ctx.reply(
          `Ingresa el monto en C$ de la devolución #${session.devolucionIndex + 1}:`,
          { parse_mode: 'Markdown' }
        );
      } else {
        const total = session.devoluciones.reduce((sum, m) => sum + m, 0);
        await ctx.reply(
          `✅ ${session.devolucionCount} devolución(es) registrada(s).\nTotal Devoluciones: *${formatCurrency(total)}*`,
          { parse_mode: 'Markdown' }
        );
        await sendArqueoMenu(ctx, session);
      }
      break;
    }

    // -----------------------------------------------------------------------
    case 'COUNTING_DENOMINATION': {
      const count = parseInt(text, 10);
      if (isNaN(count) || count < 0) {
        await ctx.reply('⚠️ Ingresa un número entero válido (0 o más).');
        return;
      }

      const denom = DENOMINATIONS[session.denominationIndex];
      if (count > 0) {
        session.denominaciones[denom.toString()] = count;
      }

      session.denominationIndex++;

      if (session.denominationIndex < DENOMINATIONS.length) {
        const nextDenom = DENOMINATIONS[session.denominationIndex];
        await ctx.reply(
          `Ingresa la cantidad de *${formatDenomination(nextDenom)}*:\n_Escribe 0 si no tienes._`,
          { parse_mode: 'Markdown' }
        );
      } else {
        // All denominations entered — compute reconciliation
        const totalEfectivo = calcTotalEfectivo(session.denominaciones);
        const montoEsperado = calcMontoEsperado(session.montoPlanilla, session.devoluciones);
        const diferencia = totalEfectivo - montoEsperado;

        session.totalEfectivo = totalEfectivo;
        session.montoEsperado = montoEsperado;
        session.diferencia = diferencia;
        session.state = 'ARQUEO_DONE';

        // Persist the report
        try {
          saveReport({
            planillaId: session.planillaId,
            montoPlanilla: session.montoPlanilla,
            ruta: session.ruta,
            devoluciones: session.devoluciones,
            montoEsperado,
            totalEfectivo,
            diferencia,
          });
        } catch (err) {
          console.error('Error saving report:', err);
        }

        const msg = buildReconciliationMessage(session);
        await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: removeKeyboard() });
        await ctx.reply('Usa /arqueo para iniciar un nuevo arqueo.');
      }
      break;
    }

    // -----------------------------------------------------------------------
    default: {
      await ctx.reply(
        'Usa /arqueo para iniciar un nuevo arqueo o /start para ver las opciones.'
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Start the bot
// ---------------------------------------------------------------------------

bot.launch();
console.log('✅ ArqueoFlow bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
