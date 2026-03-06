'use strict';

const path = require('path');
const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');
const db = require('./db');

// ---------------------------------------------------------------------------
// In-memory conversation state
// key: chat_id  →  value: state object
// ---------------------------------------------------------------------------
const sessions = new Map();

// Validation constants
const MAX_CONCEPT_LENGTH = 200;

// States
const STATE = {
  IDLE: 'IDLE',
  AWAIT_AMOUNT: 'AWAIT_AMOUNT',
  AWAIT_CONCEPT: 'AWAIT_CONCEPT',
  AWAIT_CONFIRM: 'AWAIT_CONFIRM',
  AWAIT_EDIT_AMOUNT: 'AWAIT_EDIT_AMOUNT',
  AWAIT_EDIT_CONCEPT: 'AWAIT_EDIT_CONCEPT',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { state: STATE.IDLE, draft: {} });
  }
  return sessions.get(chatId);
}

function resetSession(chatId) {
  sessions.set(chatId, { state: STATE.IDLE, draft: {} });
}

function fmt(amount) {
  return Number(amount).toFixed(2);
}

function typeLabel(type) {
  return type === 'ingreso' ? '💰 Ingreso' : '💸 Gasto';
}

// Main menu inline keyboard
const MAIN_MENU = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Nuevo Registro', callback_data: 'menu_new' }],
      [{ text: '👀 Ver Mis Registros', callback_data: 'menu_list' }],
      [{ text: '📉 Cerrar Caja / Exportar', callback_data: 'menu_export' }],
    ],
  },
};

function mainMenuMsg(name) {
  return `Hola${name ? ', ' + name : ''}! 👋\n\nElige una opción:`;
}

// ---------------------------------------------------------------------------
// Register all handlers on the bot instance
// ---------------------------------------------------------------------------

function registerHandlers(bot) {
  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    resetSession(chatId);
    const firstName = msg.from && msg.from.first_name ? msg.from.first_name : '';
    await bot.sendMessage(chatId, mainMenuMsg(firstName), MAIN_MENU);
  });

  // Callback query handler (inline keyboard buttons)
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data;
    const userId = query.from.id;
    const username = query.from.username || query.from.first_name || String(userId);

    // Always acknowledge the callback to remove the loading spinner
    await bot.answerCallbackQuery(query.id);

    const session = getSession(chatId);

    // -----------------------------------------------------------------------
    // MAIN MENU
    // -----------------------------------------------------------------------
    if (data === 'menu_main') {
      resetSession(chatId);
      await bot.editMessageText(mainMenuMsg(''), {
        chat_id: chatId,
        message_id: msgId,
        ...MAIN_MENU,
      });
      return;
    }

    if (data === 'menu_new') {
      resetSession(chatId);
      session.state = STATE.IDLE;
      await bot.editMessageText('¿Es un *Ingreso* o un *Gasto*?', {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 Ingreso', callback_data: 'type_ingreso' },
              { text: '💸 Gasto', callback_data: 'type_gasto' },
            ],
            [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
          ],
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // REGISTRATION FLOW: type selection
    // -----------------------------------------------------------------------
    if (data === 'type_ingreso' || data === 'type_gasto') {
      const type = data === 'type_ingreso' ? 'ingreso' : 'gasto';
      session.draft = { type, userId, username };
      session.state = STATE.AWAIT_AMOUNT;

      await bot.editMessageText(
        `Seleccionaste: *${typeLabel(type)}*\n\nEscribe el *monto* (solo números, ej: 150.50):`,
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
            ],
          },
        }
      );
      return;
    }

    // -----------------------------------------------------------------------
    // REGISTRATION FLOW: confirm save
    // -----------------------------------------------------------------------
    if (data === 'confirm_save') {
      const { type, amount, concept, userId: uid, username: uname } = session.draft;
      try {
        await db.insertRecord({
          user_id: uid,
          username: uname,
          type,
          amount,
          concept,
        });
        resetSession(chatId);
        await bot.editMessageText(
          `✅ *Registro guardado correctamente*\n\n${typeLabel(type)}: $${fmt(amount)}\nConcepto: ${concept}`,
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
              ],
            },
          }
        );
      } catch (err) {
        console.error('Error saving record:', err);
        await bot.editMessageText('⚠️ Error al guardar el registro. Intenta de nuevo.', {
          chat_id: chatId,
          message_id: msgId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
            ],
          },
        });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // CANCEL any flow
    // -----------------------------------------------------------------------
    if (data === 'cancel_flow') {
      resetSession(chatId);
      await bot.editMessageText('❌ Operación cancelada.', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
          ],
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // LIST TODAY'S RECORDS
    // -----------------------------------------------------------------------
    if (data === 'menu_list') {
      await showTodayRecords(bot, chatId, msgId, userId);
      return;
    }

    // -----------------------------------------------------------------------
    // DELETE a record
    // -----------------------------------------------------------------------
    if (data.startsWith('del_')) {
      const recordId = parseInt(data.split('_')[1], 10);
      try {
        const deleted = await db.deleteRecord(recordId, userId);
        if (deleted) {
          await bot.editMessageText('🗑️ Registro eliminado.', {
            chat_id: chatId,
            message_id: msgId,
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Ver Registros', callback_data: 'menu_list' }],
                [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
              ],
            },
          });
        } else {
          await bot.editMessageText('⚠️ No se encontró el registro.', {
            chat_id: chatId,
            message_id: msgId,
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
              ],
            },
          });
        }
      } catch (err) {
        console.error('Error deleting record:', err);
      }
      return;
    }

    // -----------------------------------------------------------------------
    // EDIT a record — step 1: ask new amount
    // -----------------------------------------------------------------------
    if (data.startsWith('edit_')) {
      const recordId = parseInt(data.split('_')[1], 10);
      const record = await db.getRecordById(recordId, userId);
      if (!record) {
        await bot.editMessageText('⚠️ No se encontró el registro.', {
          chat_id: chatId,
          message_id: msgId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
            ],
          },
        });
        return;
      }
      session.draft = { editId: recordId, userId };
      session.state = STATE.AWAIT_EDIT_AMOUNT;
      await bot.editMessageText(
        `✏️ Editando registro #${recordId}\nActual: *${typeLabel(record.type)}* $${fmt(record.amount)} — ${record.concept}\n\nEscribe el *nuevo monto*:`,
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
            ],
          },
        }
      );
      return;
    }

    // -----------------------------------------------------------------------
    // EXPORT / CLOSE REGISTER
    // -----------------------------------------------------------------------
    if (data === 'menu_export') {
      await handleExport(bot, chatId, msgId, userId, username);
      return;
    }
  });

  // -------------------------------------------------------------------------
  // Text message handler — captures user input during multi-step flows
  // -------------------------------------------------------------------------
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const session = getSession(chatId);
    const text = msg.text.trim();

    // -----------------------------------------------------------------------
    // AWAIT AMOUNT (new record)
    // -----------------------------------------------------------------------
    if (session.state === STATE.AWAIT_AMOUNT) {
      const amount = parseFloat(text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(
          chatId,
          '⚠️ Por favor ingresa un número válido mayor a 0 (ej: 150.50).',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
              ],
            },
          }
        );
        return;
      }
      session.draft.amount = amount;
      session.state = STATE.AWAIT_CONCEPT;
      await bot.sendMessage(chatId, 'Escribe el *concepto o descripción* del registro:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
          ],
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // AWAIT CONCEPT (new record)
    // -----------------------------------------------------------------------
    if (session.state === STATE.AWAIT_CONCEPT) {
      if (text.length === 0 || text.length > MAX_CONCEPT_LENGTH) {
        await bot.sendMessage(chatId, `⚠️ El concepto no puede estar vacío ni superar ${MAX_CONCEPT_LENGTH} caracteres.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
            ],
          },
        });
        return;
      }
      session.draft.concept = text;
      session.state = STATE.AWAIT_CONFIRM;

      const { type, amount, concept } = session.draft;
      await bot.sendMessage(
        chatId,
        `📋 *Resumen del registro:*\n\nTipo: ${typeLabel(type)}\nMonto: $${fmt(amount)}\nConcepto: ${concept}\n\n¿Confirmas?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Guardar', callback_data: 'confirm_save' },
                { text: '❌ Cancelar', callback_data: 'cancel_flow' },
              ],
            ],
          },
        }
      );
      return;
    }

    // -----------------------------------------------------------------------
    // AWAIT EDIT AMOUNT
    // -----------------------------------------------------------------------
    if (session.state === STATE.AWAIT_EDIT_AMOUNT) {
      const amount = parseFloat(text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '⚠️ Por favor ingresa un número válido mayor a 0.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
            ],
          },
        });
        return;
      }
      session.draft.newAmount = amount;
      session.state = STATE.AWAIT_EDIT_CONCEPT;
      await bot.sendMessage(chatId, 'Escribe el *nuevo concepto*:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
          ],
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // AWAIT EDIT CONCEPT
    // -----------------------------------------------------------------------
    if (session.state === STATE.AWAIT_EDIT_CONCEPT) {
      if (text.length === 0 || text.length > MAX_CONCEPT_LENGTH) {
        await bot.sendMessage(chatId, `⚠️ El concepto no puede estar vacío ni superar ${MAX_CONCEPT_LENGTH} caracteres.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancelar', callback_data: 'cancel_flow' }],
            ],
          },
        });
        return;
      }
      const { editId, newAmount } = session.draft;
      try {
        const updated = await db.updateRecord(editId, userId, {
          amount: newAmount,
          concept: text,
        });
        resetSession(chatId);
        if (updated) {
          await bot.sendMessage(
            chatId,
            `✅ *Registro #${editId} actualizado.*\nNuevo monto: $${fmt(newAmount)}\nNuevo concepto: ${text}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📋 Ver Registros', callback_data: 'menu_list' }],
                  [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
                ],
              },
            }
          );
        } else {
          await bot.sendMessage(chatId, '⚠️ No se pudo actualizar el registro.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
              ],
            },
          });
        }
      } catch (err) {
        console.error('Error updating record:', err);
        resetSession(chatId);
      }
      return;
    }

    // Default: show main menu for any unrecognized text when idle
    if (session.state === STATE.IDLE) {
      const firstName = msg.from && msg.from.first_name ? msg.from.first_name : '';
      await bot.sendMessage(chatId, mainMenuMsg(firstName), MAIN_MENU);
    }
  });
}

// ---------------------------------------------------------------------------
// Show today's records as a formatted list with Edit/Delete buttons
// ---------------------------------------------------------------------------
async function showTodayRecords(bot, chatId, msgId, userId) {
  try {
    const records = await db.getTodayRecords(userId);
    const summary = await db.getTodaySummary(userId);

    if (records.length === 0) {
      await bot.editMessageText('📭 No tienes registros para hoy.', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Nuevo Registro', callback_data: 'menu_new' }],
            [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
          ],
        },
      });
      return;
    }

    let text =
      `📋 *Registros de hoy:*\n` +
      `💰 Ingresos: $${fmt(summary.ingresos)} | 💸 Gastos: $${fmt(summary.gastos)} | Balance: $${fmt(summary.balance)}\n\n`;

    const keyboard = [];
    for (const r of records) {
      const emoji = r.type === 'ingreso' ? '💰' : '💸';
      text += `*#${r.id}* ${emoji} $${fmt(r.amount)} — ${r.concept}\n`;
      keyboard.push([
        { text: `✏️ Editar #${r.id}`, callback_data: `edit_${r.id}` },
        { text: `❌ Borrar #${r.id}`, callback_data: `del_${r.id}` },
      ]);
    }
    keyboard.push([{ text: '🔙 Menú Principal', callback_data: 'menu_main' }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    console.error('Error listing records:', err);
  }
}

// ---------------------------------------------------------------------------
// Export all records as CSV and send to chat
// ---------------------------------------------------------------------------
async function handleExport(bot, chatId, msgId, userId, username) {
  try {
    const records = await db.getAllRecords(userId);
    const summary = await db.getTodaySummary(userId);

    if (records.length === 0) {
      await bot.editMessageText('📭 No tienes registros para exportar.', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Menú Principal', callback_data: 'menu_main' }],
          ],
        },
      });
      return;
    }

    // Inform user we are generating the file
    await bot.editMessageText('⏳ Generando CSV...', {
      chat_id: chatId,
      message_id: msgId,
    });

    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const csvPath = path.join(tmpDir, `arqueoflow_${userId}_${Date.now()}.csv`);

    const csvWriter = createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'type', title: 'Tipo' },
        { id: 'amount', title: 'Monto' },
        { id: 'concept', title: 'Concepto' },
        { id: 'created_at', title: 'Fecha' },
      ],
    });

    await csvWriter.writeRecords(records);

    const caption =
      `📊 *Resumen de hoy:*\n` +
      `💰 Ingresos: $${fmt(summary.ingresos)}\n` +
      `💸 Gastos: $${fmt(summary.gastos)}\n` +
      `📈 Balance: $${fmt(summary.balance)}\n\n` +
      `Exportación completa adjunta (${records.length} registros).`;

    await bot.sendDocument(
      chatId,
      csvPath,
      { caption, parse_mode: 'Markdown' }
    );

    // Clean up temp file after sending
    fs.unlink(csvPath, () => {});

    await bot.sendMessage(chatId, mainMenuMsg(''), MAIN_MENU);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    await bot.sendMessage(chatId, '⚠️ Error al generar el CSV. Intenta más tarde.', MAIN_MENU);
  }
}

module.exports = { registerHandlers };
