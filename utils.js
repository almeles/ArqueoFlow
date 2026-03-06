'use strict';

/** Available denominations in descending order */
const DENOMINATIONS = [1000, 500, 200, 100, 50, 25, 20, 10, 5, 1];

/** Hardcoded list of selectable routes */
const ROUTES = ['10081', '10083', '10090', '10091', '10094', '10547', '10548', '10565', '10026', '10027', '10076'];

/**
 * Calculate the total amount from a denomination count map.
 * @param {object} counts  e.g. { "100": 5, "20": 10 }
 * @returns {number}
 */
function calcTotal(counts) {
  return Object.entries(counts).reduce((sum, [denom, qty]) => sum + Number(denom) * Number(qty), 0);
}

/**
 * Build a human-readable summary of the current denomination counts.
 * @param {object} counts
 * @returns {string}
 */
function buildSummary(counts) {
  const lines = DENOMINATIONS
    .filter(d => counts[String(d)] !== undefined)
    .map(d => {
      const qty = counts[String(d)];
      const subtotal = d * qty;
      return `  $${d} × ${qty} = $${subtotal.toLocaleString('es-MX')}`;
    });

  if (lines.length === 0) return '  (sin denominaciones ingresadas aún)';

  const total = calcTotal(counts);
  return lines.join('\n') + `\n\n  *Total: $${total.toLocaleString('es-MX')}*`;
}

/**
 * Format a saved arqueo record for display in Telegram.
 * @param {object} arqueo  DB row
 * @returns {string}  Markdown-formatted string
 */
function formatArqueoRecord(arqueo) {
  const counts = JSON.parse(arqueo.denominations || '{}');
  const denomLines = DENOMINATIONS
    .filter(d => counts[String(d)] !== undefined)
    .map(d => `  $${d} × ${counts[String(d)]}`)
    .join('\n');

  return (
    `🗂 *Arqueo #${arqueo.id}*\n` +
    `📅 ${arqueo.date}\n` +
    `🚌 Ruta: ${arqueo.route_id}\n` +
    `💰 Total: $${Number(arqueo.total_amount).toLocaleString('es-MX')}\n` +
    (denomLines ? `\nDesglose:\n${denomLines}` : '')
  );
}

/**
 * Convert an array of arqueo DB rows to a CSV string.
 * @param {Array<object>} rows
 * @returns {string}
 */
function toCSV(rows) {
  const header = 'id,date,user_id,username,route_id,total_amount,denominations';
  const lines = rows.map(r => {
    const denom = `"${(r.denominations || '').replace(/"/g, '""')}"`;
    const username = `"${(r.username || '').replace(/"/g, '""')}"`;
    return [r.id, r.date, r.user_id, username, r.route_id, r.total_amount, denom].join(',');
  });
  return [header, ...lines].join('\n');
}

/**
 * Build an inline keyboard grid for denomination selection.
 * @returns {Array<Array<object>>}  Telegram InlineKeyboardButton rows
 */
function denominationKeyboard() {
  const buttons = DENOMINATIONS.map(d => ({
    text: `$${d}`,
    callback_data: `denom_${d}`
  }));
  // 4 columns
  const rows = [];
  for (let i = 0; i < buttons.length; i += 4) {
    rows.push(buttons.slice(i, i + 4));
  }
  // Finish button on its own row
  rows.push([{ text: '✅ Finalizar y Guardar', callback_data: 'finish_arqueo' }]);
  rows.push([{ text: '🚫 Cancelar', callback_data: 'cancel_arqueo' }]);
  return rows;
}

/**
 * Build an inline keyboard for route selection.
 * @returns {Array<Array<object>>}
 */
function routeKeyboard() {
  const buttons = ROUTES.map(r => ({ text: r, callback_data: `route_${r}` }));
  // 3 columns
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([{ text: '🚫 Cancelar', callback_data: 'cancel_arqueo' }]);
  return rows;
}

module.exports = {
  DENOMINATIONS,
  ROUTES,
  calcTotal,
  buildSummary,
  formatArqueoRecord,
  toCSV,
  denominationKeyboard,
  routeKeyboard,
};
