'use strict';

/**
 * Validate that a planilla is exactly 6 digits.
 * @param {string} value
 * @returns {boolean}
 */
function isValidPlanilla(value) {
  return /^\d{6}$/.test(value);
}

/**
 * Format a number as NIO currency string.
 * @param {number} num
 * @returns {string}
 */
function formatNio(num) {
  return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Build a human-readable Markdown report from a session object.
 * Returns both the formatted text and the numeric grand total.
 *
 * @param {object} session  - session with usdCounts, nioCounts, planilla, route
 * @param {string} userName
 * @param {number} exchangeRate
 * @returns {{ text: string, grandTotal: number }}
 */
function formatReport(session, userName, exchangeRate) {
  const { planilla, route, usdCounts, nioCounts } = session;

  const USD_DENOMS = [1, 5, 10, 20, 50, 100];
  const NIO_DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

  let totalUsdNio = 0;
  let totalNio = 0;
  const lines = [];

  lines.push('📋 *ARQUEO DE CAJA*');
  lines.push(`👤 Usuario: ${userName}`);
  lines.push(`📄 Planilla: ${planilla}`);
  lines.push(`🛣 Ruta: ${route}`);
  lines.push(`📅 Fecha: ${new Date().toLocaleString('es-NI')}`);
  lines.push(`💱 Tasa: C$ ${exchangeRate}`);
  lines.push('─────────────────────');

  lines.push('*💵 DÓLARES (USD)*');
  for (const denom of USD_DENOMS) {
    const qty = usdCounts[denom] || 0;
    if (qty > 0) {
      const value = qty * denom * exchangeRate;
      totalUsdNio += value;
      lines.push(`  $${denom} × ${qty} = C$ ${formatNio(value)}`);
    }
  }
  lines.push(`*Total USD en NIO: C$ ${formatNio(totalUsdNio)}*`);
  lines.push('─────────────────────');

  lines.push('*🪙 CÓRDOBAS (NIO)*');
  for (const denom of NIO_DENOMS) {
    const qty = nioCounts[denom] || 0;
    if (qty > 0) {
      const value = qty * denom;
      totalNio += value;
      lines.push(`  C$${denom} × ${qty} = C$ ${formatNio(value)}`);
    }
  }
  lines.push(`*Total NIO: C$ ${formatNio(totalNio)}*`);
  lines.push('─────────────────────');

  const grandTotal = totalUsdNio + totalNio;
  lines.push(`*💰 TOTAL GENERAL: C$ ${formatNio(grandTotal)}*`);

  return { text: lines.join('\n'), grandTotal };
}

/**
 * Generate a CSV string from an array of report rows.
 * @param {object[]} reports
 * @returns {string}
 */
function generateCsv(reports) {
  const headers = ['ID', 'Usuario', 'ID Telegram', 'Planilla', 'Ruta', 'Total NIO', 'Fecha'];

  const escape = (cell) => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`;

  const rows = reports.map((r) => [
    r.id,
    r.user_name || '',
    r.user_id,
    r.planilla,
    r.route,
    Number(r.total_nio).toFixed(2),
    r.timestamp,
  ]);

  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

module.exports = { isValidPlanilla, formatNio, formatReport, generateCsv };
