'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'arqueoflow.db');

function initDb() {
  // Ensure the data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      planilla_id      TEXT    NOT NULL,
      monto_planilla   REAL    NOT NULL,
      ruta             TEXT    NOT NULL,
      devoluciones_json TEXT   NOT NULL DEFAULT '[]',
      monto_esperado   REAL    NOT NULL,
      total_efectivo   REAL    NOT NULL,
      diferencia       REAL    NOT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return db;
}

const db = initDb();

/**
 * Saves a completed arqueo report to the database.
 * @param {Object} report
 * @param {string} report.planillaId
 * @param {number} report.montoPlanilla
 * @param {string} report.ruta
 * @param {number[]} report.devoluciones  Array of return amounts, e.g. [500, 200, 100]
 * @param {number} report.montoEsperado
 * @param {number} report.totalEfectivo
 * @param {number} report.diferencia
 * @returns {number} ID of the inserted row
 */
function saveReport({ planillaId, montoPlanilla, ruta, devoluciones, montoEsperado, totalEfectivo, diferencia }) {
  const stmt = db.prepare(`
    INSERT INTO reports
      (planilla_id, monto_planilla, ruta, devoluciones_json, monto_esperado, total_efectivo, diferencia)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    planillaId,
    montoPlanilla,
    ruta,
    JSON.stringify(devoluciones),
    montoEsperado,
    totalEfectivo,
    diferencia
  );

  return result.lastInsertRowid;
}

/**
 * Retrieves the most recent arqueo reports.
 * @param {number} limit - Maximum number of records to return (default: 10)
 * @returns {Array<Object>}
 */
function getReports(limit = 10) {
  return db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?').all(limit);
}

module.exports = { saveReport, getReports };
