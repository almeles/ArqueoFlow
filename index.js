'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('./db');
const utils = require('./utils');

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_TELEGRAM_ID, 10);

if (!BOT_TOKEN || isNaN(ADMIN_ID)) {
  console.error('❌  BOT_TOKEN and ADMIN_TELEGRAM_ID must be set in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USD_DENOMS = [1, 5, 10, 20, 50, 100];
const NIO_DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

// ---------------------------------------------------------------------------
// Bot initialisation
// ---------------------------------------------------------------------------

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

/** @type {Map<number, object>} */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { state: 'idle' });
  return sessions.get(userId);
}

function setSession(userId, data) {
  sessions.set(userId, data);
}

function clearSession(userId) {
  sessions.set(userId, { state: 'idle' });
}

// ---------------------------------------------------------------------------
// Admin bootstrap — ensure the admin record exists on startup
// ---------------------------------------------------------------------------

function ensureAdmin() {
  db.createUser(ADMIN_ID, 'Admin');
  db.approveUser(ADMIN_ID);
  db.setAdminFlag(ADMIN_ID, true);
}

// ---------------------------------------------------------------------------
// Helper: send admin panel menu
// ---------------------------------------------------------------------------

function sendAdminMenu(chatId) {
  return bot.sendMessage(chatId, '👑 *Panel de Administración*\n\nSelecciona una opción:', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💱 Tasa de Cambio', callback_data: 'admin_rate' }],
        [{ text: '👥 Usuarios', callback_data: 'admin_users' }],
        [{ text: '📊 Exportar CSV', callback_data: 'admin_export' }],
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Usuario';

  if (userId === ADMIN_ID) {
    ensureAdmin();
    return bot.sendMessage(
      userId,
      '👑 *Bienvenido, Administrador!*\n\nUsa /admin para acceder al panel de administración.',
      { parse_mode: 'Markdown' }
    );
  }

  let user = db.getUser(userId);

  if (!user) {
    db.createUser(userId, name);
    user = db.getUser(userId);

    // Notify admin
    await bot.sendMessage(
      ADMIN_ID,
      `🔔 *Nueva solicitud de acceso*\n\n👤 Nombre: ${name}\n🆔 ID: \`${userId}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Aprobar', callback_data: `approve_${userId}` },
              { text: '❌ Rechazar', callback_data: `reject_${userId}` },
            ],
          ],
        },
      }
    );

    return bot.sendMessage(
      userId,
      '👋 *Bienvenido a ArqueoFlow!*\n\nTu solicitud de acceso ha sido enviada al administrador.\nTe avisaremos cuando sea procesada.',
      { parse_mode: 'Markdown' }
    );
  }

  if (user.is_approved) {
    return bot.sendMessage(
      userId,
      `✅ *Bienvenido de nuevo, ${name}!*\n\nUsa /nuevo para iniciar un arqueo o /ayuda para ver los comandos disponibles.`,
      { parse_mode: 'Markdown' }
    );
  }

  return bot.sendMessage(userId, '⏳ Tu solicitud de acceso está pendiente de aprobación.');
});

// ---------------------------------------------------------------------------
// /ayuda
// ---------------------------------------------------------------------------

bot.onText(/\/ayuda/, (msg) => {
  const userId = msg.from.id;
  const user = db.getUser(userId);

  if (userId === ADMIN_ID) {
    return bot.sendMessage(
      userId,
      '*Comandos de Administrador:*\n\n/admin — Panel de administración\n/cancelar — Cancelar operación en curso',
      { parse_mode: 'Markdown' }
    );
  }

  if (!user || !user.is_approved) {
    return bot.sendMessage(userId, 'Usa /start para solicitar acceso al sistema.');
  }

  return bot.sendMessage(
    userId,
    '*Comandos disponibles:*\n\n/nuevo — Iniciar un nuevo arqueo de caja\n/cancelar — Cancelar operación en curso\n/ayuda — Mostrar este mensaje',
    { parse_mode: 'Markdown' }
  );
});

// ---------------------------------------------------------------------------
// /nuevo — start a report
// ---------------------------------------------------------------------------

bot.onText(/\/nuevo/, (msg) => {
  const userId = msg.from.id;

  if (userId === ADMIN_ID) {
    return bot.sendMessage(userId, 'ℹ️ Los administradores no generan reportes de arqueo.');
  }

  const user = db.getUser(userId);

  if (!user || !user.is_approved) {
    return bot.sendMessage(
      userId,
      '❌ No tienes acceso aprobado. Usa /start para solicitarlo.'
    );
  }

  const routes = JSON.parse(user.allowed_routes || '[]');
  if (routes.length === 0) {
    return bot.sendMessage(
      userId,
      '❌ No tienes rutas asignadas. Contacta al administrador.'
    );
  }

  clearSession(userId);
  setSession(userId, { state: 'enter_planilla' });

  return bot.sendMessage(
    userId,
    '📋 *Nuevo Arqueo de Caja*\n\nPaso 1 de 4 — Ingresa el número de *Planilla* (6 dígitos):',
    { parse_mode: 'Markdown' }
  );
});

// ---------------------------------------------------------------------------
// /admin
// ---------------------------------------------------------------------------

bot.onText(/\/admin/, (msg) => {
  const userId = msg.from.id;

  if (userId !== ADMIN_ID) {
    return bot.sendMessage(userId, '❌ No tienes permisos de administrador.');
  }

  clearSession(userId);
  return sendAdminMenu(userId);
});

// ---------------------------------------------------------------------------
// /cancelar
// ---------------------------------------------------------------------------

bot.onText(/\/cancelar/, (msg) => {
  clearSession(msg.from.id);
  return bot.sendMessage(msg.from.id, '❌ Operación cancelada.');
});

// ---------------------------------------------------------------------------
// Callback query handler
// ---------------------------------------------------------------------------

bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id).catch(() => {});

  // ── Approve user ──────────────────────────────────────────────────────────
  if (data.startsWith('approve_')) {
    if (userId !== ADMIN_ID) return;
    const targetId = parseInt(data.slice(8), 10);
    db.approveUser(targetId);
    const user = db.getUser(targetId);

    await bot
      .editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      )
      .catch(() => {});

    await bot.sendMessage(
      query.message.chat.id,
      `✅ Usuario *${user ? user.name : targetId}* aprobado.`,
      { parse_mode: 'Markdown' }
    );

    bot
      .sendMessage(
        targetId,
        '🎉 *¡Tu acceso ha sido aprobado!*\n\nUsa /nuevo para iniciar un arqueo.',
        { parse_mode: 'Markdown' }
      )
      .catch(() => {});
    return;
  }

  // ── Reject user ───────────────────────────────────────────────────────────
  if (data.startsWith('reject_')) {
    if (userId !== ADMIN_ID) return;
    const targetId = parseInt(data.slice(7), 10);
    const user = db.getUser(targetId);
    const userName = user ? user.name : targetId;
    db.rejectUser(targetId);

    await bot
      .editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      )
      .catch(() => {});

    await bot.sendMessage(
      query.message.chat.id,
      `❌ Usuario *${userName}* rechazado y eliminado.`,
      { parse_mode: 'Markdown' }
    );

    bot.sendMessage(targetId, '❌ Tu solicitud de acceso ha sido rechazada.').catch(() => {});
    return;
  }

  // ── Admin: Tasa de cambio ─────────────────────────────────────────────────
  if (data === 'admin_rate') {
    if (userId !== ADMIN_ID) return;
    const rate = db.getConfig('exchange_rate');
    setSession(userId, { state: 'admin_edit_rate' });
    return bot.sendMessage(
      userId,
      `💱 *Tasa de Cambio Actual:* C$ ${rate}\n\nIngresa la nueva tasa (número decimal) o usa /cancelar:`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Admin: Users list ─────────────────────────────────────────────────────
  if (data === 'admin_users') {
    if (userId !== ADMIN_ID) return;
    return sendUsersList(userId);
  }

  // ── Admin: Export CSV ─────────────────────────────────────────────────────
  if (data === 'admin_export') {
    if (userId !== ADMIN_ID) return;
    return exportCsv(userId);
  }

  // ── User detail / actions ─────────────────────────────────────────────────
  if (data.startsWith('user_')) {
    if (userId !== ADMIN_ID) return;
    const parts = data.split('_');
    const action = parts[1];
    const targetId = parseInt(parts[2], 10);

    if (action === 'view') {
      return sendUserDetail(userId, targetId);
    }

    if (action === 'block') {
      db.blockUser(targetId);
      const u = db.getUser(targetId);
      await bot.sendMessage(userId, `🚫 Usuario *${u ? u.name : targetId}* bloqueado.`, {
        parse_mode: 'Markdown',
      });
      bot
        .sendMessage(targetId, '🚫 Tu acceso ha sido suspendido por el administrador.')
        .catch(() => {});
      return sendUsersList(userId);
    }

    if (action === 'assign') {
      const u = db.getUser(targetId);
      if (!u) return bot.sendMessage(userId, '❌ Usuario no encontrado.');
      const currentRoutes = JSON.parse(u.allowed_routes || '[]');
      setSession(userId, { state: 'admin_assign_routes', targetUserId: targetId });
      return bot.sendMessage(
        userId,
        `🛣 *Asignar Rutas — ${u.name}*\n\n` +
          `Rutas actuales: ${currentRoutes.length ? currentRoutes.join(', ') : '_Ninguna_'}\n\n` +
          'Ingresa las nuevas rutas separadas por coma o usa /cancelar:\n' +
          '_Ejemplo: Ruta Norte, Ruta Centro, Ruta Sur_',
        { parse_mode: 'Markdown' }
      );
    }

    return;
  }

  // ── Route selection during report ────────────────────────────────────────
  if (data.startsWith('route_')) {
    const session = getSession(userId);
    if (session.state !== 'select_route') return;

    const routeName = data.slice(6);
    setSession(userId, {
      ...session,
      state: 'enter_usd',
      route: routeName,
      usdIndex: 0,
      usdCounts: {},
      nioCounts: {},
    });

    return askUsdDenom(userId, 0);
  }

  // ── Confirm report ────────────────────────────────────────────────────────
  if (data === 'confirm_report') {
    const session = getSession(userId);
    if (session.state !== 'confirm') return;

    const user = db.getUser(userId);
    const exchangeRate = parseFloat(db.getConfig('exchange_rate'));
    const { text: reportText, grandTotal } = utils.formatReport(session, user.name, exchangeRate);

    db.saveReport(userId, session.planilla, session.route, { usd: session.usdCounts, nio: session.nioCounts }, grandTotal);

    // Send copy to admin
    bot
      .sendMessage(ADMIN_ID, `📋 *Nuevo Reporte Recibido*\n\n${reportText}`, {
        parse_mode: 'Markdown',
      })
      .catch(() => {});

    clearSession(userId);
    return bot.sendMessage(userId, '✅ *¡Arqueo guardado exitosamente!*\n\nUsa /nuevo para registrar otro.', {
      parse_mode: 'Markdown',
    });
  }

  // ── Cancel report ─────────────────────────────────────────────────────────
  if (data === 'cancel_report') {
    clearSession(userId);
    return bot.sendMessage(userId, '❌ Arqueo cancelado.');
  }
});

// ---------------------------------------------------------------------------
// Message handler — state machine
// ---------------------------------------------------------------------------

bot.on('message', async (msg) => {
  // Skip commands (handled by onText handlers above)
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const text = msg.text.trim();
  const session = getSession(userId);

  switch (session.state) {
    case 'enter_planilla':
      return handlePlanilla(userId, text);

    case 'enter_usd':
      return handleUsdCount(userId, text, session);

    case 'enter_nio':
      return handleNioCount(userId, text, session);

    case 'admin_edit_rate':
      if (userId === ADMIN_ID) return handleEditRate(userId, text);
      break;

    case 'admin_assign_routes':
      if (userId === ADMIN_ID) return handleAssignRoutes(userId, text, session);
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// Report flow helpers
// ---------------------------------------------------------------------------

async function handlePlanilla(userId, text) {
  if (!utils.isValidPlanilla(text)) {
    return bot.sendMessage(
      userId,
      '❌ La planilla debe tener exactamente *6 dígitos* numéricos. Inténtalo de nuevo:',
      { parse_mode: 'Markdown' }
    );
  }

  const user = db.getUser(userId);
  const routes = JSON.parse(user.allowed_routes || '[]');

  if (routes.length === 0) {
    clearSession(userId);
    return bot.sendMessage(userId, '❌ No tienes rutas asignadas. Contacta al administrador.');
  }

  const session = getSession(userId);
  setSession(userId, { ...session, state: 'select_route', planilla: text });

  const keyboard = routes.map((r) => [{ text: r, callback_data: `route_${r}` }]);

  return bot.sendMessage(userId, '🛣 *Paso 2 de 4 — Selecciona tu Ruta:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function askUsdDenom(userId, index) {
  const denom = USD_DENOMS[index];
  const progress = `${index + 1}/${USD_DENOMS.length}`;
  return bot.sendMessage(
    userId,
    `💵 *Paso 3 de 4 — Billetes USD* (${progress})\n\n¿Cuántos billetes de *$${denom}* tienes?\n_Ingresa 0 si no tienes._`,
    { parse_mode: 'Markdown' }
  );
}

async function askNioDenom(userId, index) {
  const denom = NIO_DENOMS[index];
  const progress = `${index + 1}/${NIO_DENOMS.length}`;
  return bot.sendMessage(
    userId,
    `🪙 *Paso 3 de 4 — Córdobas NIO* (${progress})\n\n¿Cuántos billetes/monedas de *C$${denom}* tienes?\n_Ingresa 0 si no tienes._`,
    { parse_mode: 'Markdown' }
  );
}

async function handleUsdCount(userId, text, session) {
  const qty = parseInt(text, 10);

  if (isNaN(qty) || qty < 0 || String(qty) !== text.replace(/\s/g, '')) {
    return bot.sendMessage(userId, '❌ Ingresa un número entero válido (0 o mayor):');
  }

  const denom = USD_DENOMS[session.usdIndex];
  const newUsdCounts = { ...session.usdCounts, [denom]: qty };
  const nextIndex = session.usdIndex + 1;

  if (nextIndex < USD_DENOMS.length) {
    setSession(userId, { ...session, usdCounts: newUsdCounts, usdIndex: nextIndex });
    return askUsdDenom(userId, nextIndex);
  }

  // All USD done — start NIO
  setSession(userId, {
    ...session,
    usdCounts: newUsdCounts,
    state: 'enter_nio',
    nioIndex: 0,
    nioCounts: {},
  });
  return askNioDenom(userId, 0);
}

async function handleNioCount(userId, text, session) {
  const qty = parseInt(text, 10);

  if (isNaN(qty) || qty < 0 || String(qty) !== text.replace(/\s/g, '')) {
    return bot.sendMessage(userId, '❌ Ingresa un número entero válido (0 o mayor):');
  }

  const denom = NIO_DENOMS[session.nioIndex];
  const newNioCounts = { ...session.nioCounts, [denom]: qty };
  const nextIndex = session.nioIndex + 1;

  if (nextIndex < NIO_DENOMS.length) {
    setSession(userId, { ...session, nioCounts: newNioCounts, nioIndex: nextIndex });
    return askNioDenom(userId, nextIndex);
  }

  // All denominations done — show summary
  const updatedSession = { ...session, nioCounts: newNioCounts, state: 'confirm' };
  setSession(userId, updatedSession);

  const user = db.getUser(userId);
  const exchangeRate = parseFloat(db.getConfig('exchange_rate'));
  const { text: reportText } = utils.formatReport(updatedSession, user.name, exchangeRate);

  return bot.sendMessage(
    userId,
    `*Paso 4 de 4 — Confirma tu Arqueo:*\n\n${reportText}\n\n¿Deseas guardar este arqueo?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirmar y Enviar', callback_data: 'confirm_report' },
            { text: '❌ Cancelar', callback_data: 'cancel_report' },
          ],
        ],
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Admin action helpers
// ---------------------------------------------------------------------------

async function handleEditRate(userId, text) {
  const rate = parseFloat(text);

  if (isNaN(rate) || rate <= 0) {
    return bot.sendMessage(
      userId,
      '❌ Tasa inválida. Ingresa un número positivo (ej. *36.6243*) o usa /cancelar:',
      { parse_mode: 'Markdown' }
    );
  }

  db.setConfig('exchange_rate', rate.toFixed(4));
  clearSession(userId);
  return bot.sendMessage(
    userId,
    `✅ Tasa de cambio actualizada a *C$ ${rate.toFixed(4)}*`,
    { parse_mode: 'Markdown' }
  );
}

async function handleAssignRoutes(userId, text, session) {
  const routes = text
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  if (routes.length === 0) {
    return bot.sendMessage(
      userId,
      '❌ Ingresa al menos una ruta. Ejemplo: _Ruta Norte, Ruta Centro_\nO usa /cancelar.',
      { parse_mode: 'Markdown' }
    );
  }

  db.assignRoutes(session.targetUserId, routes);
  const u = db.getUser(session.targetUserId);
  clearSession(userId);

  await bot.sendMessage(
    userId,
    `✅ Rutas asignadas a *${u ? u.name : session.targetUserId}*:\n${routes.map((r) => `• ${r}`).join('\n')}`,
    { parse_mode: 'Markdown' }
  );

  bot
    .sendMessage(
      session.targetUserId,
      `🛣 Se te han asignado las siguientes rutas:\n${routes.map((r) => `• ${r}`).join('\n')}\n\nUsa /nuevo para iniciar un arqueo.`
    )
    .catch(() => {});
}

async function sendUsersList(adminId) {
  const users = db.getAllUsers();

  if (users.length === 0) {
    return bot.sendMessage(adminId, '👥 No hay usuarios registrados.');
  }

  const keyboard = users.map((u) => {
    const statusIcon = u.is_approved ? '✅' : '⏳';
    return [
      {
        text: `${statusIcon} ${u.name}`,
        callback_data: `user_view_${u.telegram_id}`,
      },
    ];
  });

  return bot.sendMessage(adminId, '👥 *Usuarios registrados:*\n\n✅ = Aprobado  ⏳ = Pendiente', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function sendUserDetail(adminId, targetId) {
  const u = db.getUser(targetId);
  if (!u) return bot.sendMessage(adminId, '❌ Usuario no encontrado.');

  const routes = JSON.parse(u.allowed_routes || '[]');
  const status = u.is_approved ? '✅ Aprobado' : '⏳ Pendiente';

  return bot.sendMessage(
    adminId,
    `👤 *${u.name}*\n🆔 ID: \`${u.telegram_id}\`\n📊 Estado: ${status}\n🛣 Rutas: ${
      routes.length ? routes.join(', ') : '_Ninguna_'
    }`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🛣 Asignar Ruta', callback_data: `user_assign_${targetId}` },
            { text: '🚫 Bloquear', callback_data: `user_block_${targetId}` },
          ],
          [{ text: '« Volver a Usuarios', callback_data: 'admin_users' }],
        ],
      },
    }
  );
}

async function exportCsv(adminId) {
  const reports = db.getAllReports();

  if (reports.length === 0) {
    return bot.sendMessage(adminId, '📊 No hay reportes para exportar.');
  }

  const csvContent = utils.generateCsv(reports);
  const tmpPath = path.join(os.tmpdir(), `arqueoflow_${Date.now()}.csv`);

  try {
    try {
      fs.writeFileSync(tmpPath, '\uFEFF' + csvContent, 'utf8'); // BOM for Excel compatibility
    } catch (writeErr) {
      console.error('Error writing temp CSV file:', writeErr);
      return bot.sendMessage(adminId, '❌ Error al generar el archivo CSV. Inténtalo de nuevo.');
    }
    await bot.sendDocument(
      adminId,
      tmpPath,
      { caption: `📊 Exportación — ${reports.length} reporte(s)` },
      { filename: `arqueoflow_${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv' }
    );
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

ensureAdmin();
console.log('🚀 ArqueoFlow bot iniciado correctamente.');
