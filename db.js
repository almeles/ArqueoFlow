'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'arqueoflow.db');
const DEFAULT_EXCHANGE_RATE = '36.6243';

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initialize(_db);
  }
  return _db;
}

function initialize(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      planilla    TEXT,
      allowed_routes TEXT NOT NULL DEFAULT '[]',
      is_approved INTEGER NOT NULL DEFAULT 0,
      is_admin    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reports (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL,
      planilla  TEXT    NOT NULL,
      route     TEXT    NOT NULL,
      details   TEXT    NOT NULL,
      total_nio REAL    NOT NULL,
      timestamp TEXT    NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed default exchange rate if not present
  const existing = db
    .prepare("SELECT value FROM config WHERE key = 'exchange_rate'")
    .get();
  if (!existing) {
    db.prepare("INSERT INTO config (key, value) VALUES ('exchange_rate', ?)").run(DEFAULT_EXCHANGE_RATE);
  }
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

function getUser(telegramId) {
  return getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function createUser(telegramId, name) {
  return getDb()
    .prepare('INSERT OR IGNORE INTO users (telegram_id, name) VALUES (?, ?)')
    .run(telegramId, name);
}

function approveUser(telegramId) {
  return getDb()
    .prepare('UPDATE users SET is_approved = 1 WHERE telegram_id = ?')
    .run(telegramId);
}

function rejectUser(telegramId) {
  return getDb()
    .prepare('DELETE FROM users WHERE telegram_id = ?')
    .run(telegramId);
}

function blockUser(telegramId) {
  return getDb()
    .prepare('UPDATE users SET is_approved = 0 WHERE telegram_id = ?')
    .run(telegramId);
}

function setAdminFlag(telegramId, isAdmin) {
  return getDb()
    .prepare('UPDATE users SET is_admin = ? WHERE telegram_id = ?')
    .run(isAdmin ? 1 : 0, telegramId);
}

function assignRoutes(telegramId, routes) {
  return getDb()
    .prepare('UPDATE users SET allowed_routes = ? WHERE telegram_id = ?')
    .run(JSON.stringify(routes), telegramId);
}

function getAllUsers() {
  return getDb()
    .prepare('SELECT * FROM users WHERE is_admin = 0 ORDER BY name')
    .all();
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

function saveReport(userId, planilla, route, details, totalNio) {
  const timestamp = new Date().toISOString();
  return getDb()
    .prepare(
      'INSERT INTO reports (user_id, planilla, route, details, total_nio, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(userId, planilla, route, JSON.stringify(details), totalNio, timestamp);
}

function getAllReports() {
  return getDb()
    .prepare(
      `SELECT r.*, u.name AS user_name
       FROM reports r
       LEFT JOIN users u ON r.user_id = u.telegram_id
       ORDER BY r.timestamp DESC`
    )
    .all();
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfig(key) {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  return getDb()
    .prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

module.exports = {
  getUser,
  createUser,
  approveUser,
  rejectUser,
  blockUser,
  setAdminFlag,
  assignRoutes,
  getAllUsers,
  saveReport,
  getAllReports,
  getConfig,
  setConfig,
};
