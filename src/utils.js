'use strict';

/**
 * Nicaraguan Córdoba (NIO) denominations in descending order.
 * Includes bills (1000–1) and coins (0.50, 0.25, 0.10).
 */
const NIO_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.50, 0.25, 0.10];

/**
 * Format a number for display with exactly 2 decimal places.
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  return Number(n || 0).toFixed(2);
}

/**
 * Calculate the total cash from a denomination-count map.
 * Uses integer (cent) arithmetic to avoid JavaScript floating-point issues
 * (e.g. 3 * 0.10 = 0.30000000000000004 in naive float math).
 *
 * @param {Object.<string, number>} counts  Keys are denomination strings, values are counts.
 * @returns {number}  Total value rounded to 2 decimal places.
 */
function calculateTotal(counts) {
  let totalCents = 0;
  for (const [denom, count] of Object.entries(counts)) {
    const denomCents = Math.round(parseFloat(denom) * 100);
    totalCents += denomCents * Math.round(Number(count));
  }
  return totalCents / 100;
}

module.exports = { NIO_DENOMINATIONS, fmt, calculateTotal };
