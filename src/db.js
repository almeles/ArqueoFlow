'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'arqueo.db');

let db;

/**
 * Opens (or creates) the SQLite database and ensures the schema is up to date.
 * Returns a Promise that resolves when the DB is ready.
 */
function initDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run(
          `CREATE TABLE IF NOT EXISTS records (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id   INTEGER NOT NULL,
            username  TEXT,
            type      TEXT    NOT NULL CHECK(type IN ('ingreso','gasto')),
            amount    REAL    NOT NULL,
            concept   TEXT    NOT NULL,
            created_at TEXT   NOT NULL DEFAULT (datetime('now','localtime'))
          )`,
          (err) => {
            if (err) return reject(err);
            resolve(db);
          }
        );
      });
    });
  });
}

/**
 * Insert a new record.
 * @param {object} record - { user_id, username, type, amount, concept }
 * @returns {Promise<number>} The new record's id.
 */
function insertRecord({ user_id, username, type, amount, concept }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO records (user_id, username, type, amount, concept)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, username || '', type, amount, concept],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

/**
 * Fetch today's records for a user (ordered by id ASC).
 * @param {number} user_id
 * @returns {Promise<Array>}
 */
function getTodayRecords(user_id) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM records
       WHERE user_id = ?
         AND date(created_at) = date('now','localtime')
       ORDER BY id ASC`,
      [user_id],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

/**
 * Fetch all records for a user (ordered by created_at ASC).
 * Used for CSV export.
 * @param {number} user_id
 * @returns {Promise<Array>}
 */
function getAllRecords(user_id) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM records
       WHERE user_id = ?
       ORDER BY created_at ASC`,
      [user_id],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

/**
 * Fetch a single record by id (checking ownership).
 * @param {number} id
 * @param {number} user_id
 * @returns {Promise<object|null>}
 */
function getRecordById(id, user_id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM records WHERE id = ? AND user_id = ?`,
      [id, user_id],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

/**
 * Update amount and concept of an existing record.
 * @param {number} id
 * @param {number} user_id
 * @param {object} fields - { amount, concept }
 * @returns {Promise<boolean>} True if a row was updated.
 */
function updateRecord(id, user_id, { amount, concept }) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE records SET amount = ?, concept = ? WHERE id = ? AND user_id = ?`,
      [amount, concept, id, user_id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

/**
 * Delete a record by id (checking ownership).
 * @param {number} id
 * @param {number} user_id
 * @returns {Promise<boolean>} True if a row was deleted.
 */
function deleteRecord(id, user_id) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM records WHERE id = ? AND user_id = ?`,
      [id, user_id],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

/**
 * Compute totals for today's records of a user.
 * @param {number} user_id
 * @returns {Promise<{ingresos: number, gastos: number, balance: number}>}
 */
async function getTodaySummary(user_id) {
  const rows = await getTodayRecords(user_id);
  let ingresos = 0;
  let gastos = 0;
  for (const r of rows) {
    if (r.type === 'ingreso') ingresos += r.amount;
    else gastos += r.amount;
  }
  return { ingresos, gastos, balance: ingresos - gastos };
}

module.exports = {
  initDB,
  insertRecord,
  getTodayRecords,
  getAllRecords,
  getRecordById,
  updateRecord,
  deleteRecord,
  getTodaySummary,
};
