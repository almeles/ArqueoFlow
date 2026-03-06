'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'arqueoflow.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS arqueos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id      INTEGER NOT NULL,
    route        TEXT    NOT NULL,
    planilla     REAL    NOT NULL,
    devol_count  INTEGER NOT NULL DEFAULT 0,
    devol_amount REAL    NOT NULL DEFAULT 0,
    cash_usd     REAL    NOT NULL DEFAULT 0,
    cash_nio     REAL    NOT NULL DEFAULT 0,
    total_caja   REAL    NOT NULL DEFAULT 0,
    diff         REAL    NOT NULL DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'pending',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Persist a completed arqueo.
 *
 * @param {Object} params
 * @returns {number}  Auto-generated row id.
 */
function saveArqueo({ chatId, route, planilla, devolCount, devolAmount, cashUsd, cashNio }) {
  const totalCaja = cashUsd + cashNio;
  const diff      = Math.round((totalCaja - (planilla - devolAmount)) * 100) / 100;
  const status    = diff === 0 ? 'cuadrado' : diff < 0 ? 'faltante' : 'sobrante';

  const stmt = db.prepare(`
    INSERT INTO arqueos
      (chat_id, route, planilla, devol_count, devol_amount, cash_usd, cash_nio, total_caja, diff, status)
    VALUES
      (@chatId, @route, @planilla, @devolCount, @devolAmount, @cashUsd, @cashNio, @totalCaja, @diff, @status)
  `);

  return stmt.run({ chatId, route, planilla, devolCount, devolAmount, cashUsd, cashNio, totalCaja, diff, status })
    .lastInsertRowid;
}

/**
 * Retrieve the most recent arqueos for a given chat.
 *
 * @param {number} chatId
 * @param {number} [limit=10]
 * @returns {Array<Object>}
 */
function getHistory(chatId, limit = 10) {
  return db
    .prepare('SELECT * FROM arqueos WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(chatId, limit);
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve arqueos across all chats (admin use).
 *
 * @param {Object}  [opts]
 * @param {string|null} [opts.status]  Filter by status value, or null for all.
 * @param {number}      [opts.limit=10]
 * @returns {Array<Object>}
 */
function getAllArqueos({ status = null, limit = 10 } = {}) {
  if (status) {
    return db
      .prepare('SELECT * FROM arqueos WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(status, limit);
  }
  return db
    .prepare('SELECT * FROM arqueos ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

/**
 * Retrieve a single arqueo by its id.
 *
 * @param {number} id
 * @returns {Object|undefined}
 */
function getArqueoById(id) {
  return db
    .prepare('SELECT * FROM arqueos WHERE id = ?')
    .get(id);
}

/**
 * Update the status of an arqueo (e.g. 'aprobado' or 'rechazado').
 *
 * @param {number} id
 * @param {string} status
 * @returns {number}  Number of rows changed (0 if id not found).
 */
function updateArqueoStatus(id, status) {
  return db
    .prepare('UPDATE arqueos SET status = ? WHERE id = ?')
    .run(status, id)
    .changes;
}

/**
 * Get a count of arqueos grouped by status.
 *
 * @returns {Array<{status: string, count: number}>}
 */
function getStats() {
  return db
    .prepare('SELECT status, COUNT(*) AS count FROM arqueos GROUP BY status ORDER BY count DESC')
    .all();
}

/**
 * Retrieve arqueos that have not yet been reviewed (approved or rejected).
 * These are arqueos whose status is 'cuadrado', 'faltante', or 'sobrante'.
 *
 * @param {number} [limit=10]
 * @returns {Array<Object>}
 */
function getUnreviewedArqueos(limit = 10) {
  return db
    .prepare(`SELECT * FROM arqueos
              WHERE status NOT IN ('aprobado', 'rechazado')
              ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

module.exports = { saveArqueo, getHistory, getAllArqueos, getArqueoById, updateArqueoStatus, getStats, getUnreviewedArqueos };
