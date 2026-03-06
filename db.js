'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'arqueo.db');

let db;

/**
 * Initialise the SQLite database and create tables if they do not exist.
 * @returns {Database} The open database instance.
 */
function initDB() {
  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS arqueos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      username    TEXT,
      route_id    TEXT    NOT NULL,
      total_amount REAL   NOT NULL,
      denominations TEXT  NOT NULL
    );
  `);

  return db;
}

/**
 * Save a completed arqueo record.
 * @param {object} data
 * @param {string} data.date         ISO date string (YYYY-MM-DD HH:MM:SS)
 * @param {number} data.user_id      Telegram user id
 * @param {string} data.username     Telegram username (may be empty)
 * @param {string} data.route_id     Route identifier
 * @param {number} data.total_amount Total cash amount
 * @param {object} data.denominations Map of denomination -> quantity
 * @returns {number} The newly inserted row id
 */
function saveArqueo({ date, user_id, username, route_id, total_amount, denominations }) {
  const stmt = db.prepare(`
    INSERT INTO arqueos (date, user_id, username, route_id, total_amount, denominations)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    date,
    user_id,
    username || '',
    route_id,
    total_amount,
    JSON.stringify(denominations)
  );
  return info.lastInsertRowid;
}

/**
 * Return all arqueos saved today for a specific user.
 * @param {number} userId
 * @returns {Array<object>}
 */
function getTodayArqueosByUser(userId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const stmt = db.prepare(`
    SELECT * FROM arqueos
    WHERE user_id = ? AND date LIKE ?
    ORDER BY id DESC
  `);
  return stmt.all(userId, `${today}%`);
}

/**
 * Return a single arqueo by its id.
 * @param {number} id
 * @returns {object|undefined}
 */
function getArqueoById(id) {
  return db.prepare('SELECT * FROM arqueos WHERE id = ?').get(id);
}

/**
 * Delete an arqueo by its id.
 * @param {number} id
 * @returns {number} Number of rows deleted (0 or 1)
 */
function deleteArqueo(id) {
  const info = db.prepare('DELETE FROM arqueos WHERE id = ?').run(id);
  return info.changes;
}

/**
 * Return all arqueo records (used for admin CSV export).
 * @returns {Array<object>}
 */
function getAllArqueos() {
  return db.prepare('SELECT * FROM arqueos ORDER BY id DESC').all();
}

module.exports = { initDB, saveArqueo, getTodayArqueosByUser, getArqueoById, deleteArqueo, getAllArqueos };
