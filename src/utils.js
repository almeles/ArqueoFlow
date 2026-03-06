'use strict';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Total character width of every line in the receipt body. */
const LINE_WIDTH   = 27;
/** Width of the label column (ASCII labels are padded to this). */
const LABEL_WIDTH  = 15;
/** Width of the number field (right-aligned inside "C$<NUM_FIELD>"). */
const NUM_FIELD    = 10;

const SEP_DOUBLE = '='.repeat(LINE_WIDTH);
const SEP_SINGLE = '-'.repeat(LINE_WIDTH);

// ---------------------------------------------------------------------------
// Number / amount formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a non-negative number with comma thousands-separator and 2 decimals.
 * Locale-independent implementation.
 *
 * @param {number} n
 * @returns {string}  e.g. "10,000.00"
 */
function formatNumber(n) {
  const fixed = Math.abs(n).toFixed(2);
  const [int, dec] = fixed.split('.');
  const intWithCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intWithCommas}.${dec}`;
}

/**
 * Format a monetary amount as "C$ XX,XXX.XX" with the number right-aligned
 * inside a fixed-width field.  Total value string is always 12 characters:
 *   "C$" (2) + right-aligned number in NUM_FIELD (10) = 12.
 *
 * @param {number} amount
 * @returns {string}  e.g. "C$ 10,000.00" or "C$    500.00"
 */
function formatAmount(amount) {
  return 'C$' + formatNumber(amount).padStart(NUM_FIELD);
}

/**
 * Left-align a plain (ASCII) label and pad it to LABEL_WIDTH with spaces.
 *
 * @param {string} label
 * @returns {string}
 */
function padLabel(label) {
  return label.padEnd(LABEL_WIDTH);
}

/**
 * Left-align a label that starts with a flag emoji.
 *
 * Flag emojis (e.g. 🇺🇸, 🇳🇮) are each composed of two Unicode surrogate
 * pairs → JavaScript string length = 4, but visual width ≈ 2 columns.
 * Padding to (LABEL_WIDTH + 2) compensates for the 2-unit discrepancy so
 * that the "C$" value column aligns with the ASCII-label rows.
 *
 * @param {string} label
 * @returns {string}
 */
function padFlagLabel(label) {
  return label.padEnd(LABEL_WIDTH + 2);
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Return the coloured circle emoji for a given difference.
 *
 *   diff === 0  →  🟢  (cuadrado / balanced)
 *   diff <  0   →  🔴  (faltante / deficit)
 *   diff >  0   →  🟡  (sobrante / surplus)
 *
 * @param {number} diff  totalCaja − aEntregar
 * @returns {string}
 */
function getStatusEmoji(diff) {
  if (diff === 0) return '🟢';
  if (diff  < 0) return '🔴';
  return '🟡';
}

/**
 * Return the human-readable status label for a given difference.
 *
 * @param {number} diff
 * @returns {string}
 */
function getStatusLabel(diff) {
  if (diff === 0) return 'CUADRADO';
  if (diff  < 0) return `FALTANTE C$${formatNumber(Math.abs(diff))}`;
  return `SOBRANTE C$${formatNumber(diff)}`;
}

// ---------------------------------------------------------------------------
// Summary / receipt generator
// ---------------------------------------------------------------------------

/**
 * Generate a receipt-style arqueo summary as a MarkdownV2 message.
 *
 * The financial block is wrapped in a triple-backtick code fence so Telegram
 * renders it in a fixed-width (monospace) font, enabling right-aligned
 * number columns.
 *
 * Example output (inside the code block):
 * ```
 * ===========================
 *    ARQUEO DE RUTA 10081
 * ===========================
 * PLANILLA:      C$ 10,000.00
 * (-) DEVOL (3): C$    500.00
 * ---------------------------
 * A ENTREGAR:    C$  9,500.00
 * ===========================
 * EFECTIVO:
 * 🇺🇸 USD:        C$  3,662.43
 * 🇳🇮 NIO:        C$  5,837.57
 * ---------------------------
 * TOTAL CAJA:    C$  9,500.00
 * ===========================
 * ESTADO: 🟢 CUADRADO
 * ```
 *
 * @param {Object}        params
 * @param {string|number} params.route       - Route identifier (e.g. 10081)
 * @param {number}        params.planilla    - Planned collection amount (C$)
 * @param {number}        params.devolCount  - Number of returns
 * @param {number}        params.devolAmount - Total return amount (C$)
 * @param {number}        params.cashUsd     - USD cash converted to C$
 * @param {number}        params.cashNio     - NIO cash in C$
 * @returns {string}  MarkdownV2 message string
 */
function generateSummary({ route, planilla, devolCount, devolAmount, cashUsd, cashNio }) {
  const aEntregar = planilla - devolAmount;
  const totalCaja = cashUsd + cashNio;
  const diff      = Math.round((totalCaja - aEntregar) * 100) / 100;

  const statusEmoji = getStatusEmoji(diff);
  const statusLabel = getStatusLabel(diff);

  const title = `ARQUEO DE RUTA ${route}`;
  const titlePad = Math.floor((LINE_WIDTH - title.length) / 2);
  const centeredTitle = ' '.repeat(Math.max(0, titlePad)) + title;

  const lines = [
    SEP_DOUBLE,
    centeredTitle,
    SEP_DOUBLE,
    padLabel('PLANILLA:')              + formatAmount(planilla),
    padLabel(`(-) DEVOL (${devolCount}):`) + formatAmount(devolAmount),
    SEP_SINGLE,
    padLabel('A ENTREGAR:')            + formatAmount(aEntregar),
    SEP_DOUBLE,
    'EFECTIVO:',
    padFlagLabel('🇺🇸 USD:')           + formatAmount(cashUsd),
    padFlagLabel('🇳🇮 NIO:')           + formatAmount(cashNio),
    SEP_SINGLE,
    padLabel('TOTAL CAJA:')            + formatAmount(totalCaja),
    SEP_DOUBLE,
    `ESTADO: ${statusEmoji} ${statusLabel}`
  ];

  return '```\n' + lines.join('\n') + '\n```';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  formatNumber,
  formatAmount,
  padLabel,
  padFlagLabel,
  getStatusEmoji,
  getStatusLabel,
  generateSummary
};
