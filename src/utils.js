'use strict';

/**
 * NIO (Córdoba) denominations used for cash counting, from highest to lowest.
 */
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1];

/**
 * Formats a numeric amount as a NIO currency string.
 * @param {number} amount
 * @returns {string}  e.g. "C$ 10,500" or "C$ 9,450.50"
 */
function formatCurrency(amount) {
  const formatted = amount.toLocaleString('es-NI', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `C$ ${formatted}`;
}

/**
 * Formats a denomination label for display.
 * @param {number} denom
 * @returns {string}  e.g. "C$ 500" or "C$ 0.50"
 */
function formatDenomination(denom) {
  if (denom >= 1) {
    return `C$ ${denom}`;
  }
  return `C$ ${denom.toFixed(2)}`;
}

/**
 * Calculates the Monto Esperado (expected amount to deliver).
 * Monto Esperado = Monto Planilla - Sum(Devoluciones)
 * @param {number} montoPlanilla
 * @param {Array<{facturaId: string, monto: number}>} devoluciones
 * @returns {number}
 */
function calcMontoEsperado(montoPlanilla, devoluciones) {
  const totalDevoluciones = devoluciones.reduce((sum, d) => sum + d.monto, 0);
  return montoPlanilla - totalDevoluciones;
}

/**
 * Calculates the total cash from a denomination count map.
 * @param {Object<string, number>} denominaciones  e.g. { "500": 3, "100": 2 }
 * @returns {number}
 */
function calcTotalEfectivo(denominaciones) {
  return DENOMINATIONS.reduce((sum, denom) => {
    const count = denominaciones[denom.toString()] || 0;
    return sum + denom * count;
  }, 0);
}

/**
 * Builds the final reconciliation message for the arqueo.
 * @param {Object} session
 * @param {string}  session.planillaId
 * @param {string}  session.ruta
 * @param {number}  session.montoPlanilla
 * @param {Array<{facturaId: string, monto: number}>} session.devoluciones
 * @param {number}  session.montoEsperado
 * @param {number}  session.totalEfectivo
 * @returns {string}
 */
function buildReconciliationMessage(session) {
  const { planillaId, ruta, montoPlanilla, devoluciones, montoEsperado, totalEfectivo } = session;
  const diferencia = totalEfectivo - montoEsperado;
  const totalDevoluciones = devoluciones.reduce((sum, d) => sum + d.monto, 0);
  const facturaIds = devoluciones.map((d) => d.facturaId).join(', ');

  let resultado;
  if (Math.abs(diferencia) < 0.005) {
    resultado = '✅ CUADRADO';
  } else if (diferencia > 0) {
    resultado = `✅ SOBRANTE ${formatCurrency(diferencia)}`;
  } else {
    resultado = `❌ FALTANTE ${formatCurrency(diferencia)}`;
  }

  let msg = `📊 *RESUMEN ARQUEO*\n\n`;
  msg += `📋 Planilla: #${planillaId}\n`;
  msg += `🛣️ Ruta: ${ruta}\n\n`;
  msg += `💰 Planilla: ${formatCurrency(montoPlanilla)}\n`;

  if (devoluciones.length > 0) {
    msg += `(-) Devoluciones: ${formatCurrency(totalDevoluciones)}`;
    if (facturaIds) {
      msg += ` (Facturas: ${facturaIds})`;
    }
    msg += '\n';
  }

  msg += `(=) A Entregar: ${formatCurrency(montoEsperado)}\n`;
  msg += `(Actual) Efectivo: ${formatCurrency(totalEfectivo)}\n\n`;
  msg += `*RESULTADO: ${resultado}*`;

  return msg;
}

module.exports = {
  DENOMINATIONS,
  formatCurrency,
  formatDenomination,
  calcMontoEsperado,
  calcTotalEfectivo,
  buildReconciliationMessage,
};
