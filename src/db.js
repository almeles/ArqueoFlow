'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'arqueoflow.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// WAL mode improves concurrency and performance for read-heavy workloads.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id   TEXT    UNIQUE NOT NULL,
    username      TEXT,
    first_name    TEXT,
    role          TEXT    NOT NULL DEFAULT 'pending',
    route_id      INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS routes (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT    NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS currency_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_code TEXT    UNIQUE NOT NULL,
    rate_to_nio   REAL    NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS arqueos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    route_id     INTEGER NOT NULL,
    date         TEXT    NOT NULL,
    denominations TEXT   NOT NULL,
    total_nio    REAL    NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)  REFERENCES users(id),
    FOREIGN KEY (route_id) REFERENCES routes(id)
  );

  CREATE TABLE IF NOT EXISTS daily_targets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    date          TEXT NOT NULL,
    route_id      INTEGER NOT NULL,
    target_amount REAL NOT NULL,
    UNIQUE(date, route_id),
    FOREIGN KEY (route_id) REFERENCES routes(id)
  );
`);

// ─── User queries ──────────────────────────────────────────────────────────────

function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId)) || null;
}

function createUser(telegramId, username, firstName, role) {
  db.prepare(
    'INSERT OR IGNORE INTO users (telegram_id, username, first_name, role) VALUES (?, ?, ?, ?)'
  ).run(String(telegramId), username || '', firstName || '', role || 'pending');
}

function updateUserRole(telegramId, role) {
  db.prepare('UPDATE users SET role = ? WHERE telegram_id = ?').run(role, String(telegramId));
}

function updateUserRoute(telegramId, routeId) {
  db.prepare('UPDATE users SET route_id = ? WHERE telegram_id = ?').run(routeId, String(telegramId));
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function getPendingUsers() {
  return db.prepare("SELECT * FROM users WHERE role = 'pending' ORDER BY created_at ASC").all();
}

// ─── Route queries ─────────────────────────────────────────────────────────────

function getRoutes() {
  return db.prepare('SELECT * FROM routes WHERE active = 1 ORDER BY name ASC').all();
}

function createRoute(name) {
  return db.prepare('INSERT INTO routes (name) VALUES (?)').run(name);
}

// ─── Currency rate queries ─────────────────────────────────────────────────────

function getCurrencyRates() {
  return db.prepare('SELECT * FROM currency_rates ORDER BY currency_code ASC').all();
}

function upsertCurrencyRate(code, rate) {
  db.prepare(`
    INSERT INTO currency_rates (currency_code, rate_to_nio, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(currency_code) DO UPDATE SET
      rate_to_nio = excluded.rate_to_nio,
      updated_at  = CURRENT_TIMESTAMP
  `).run(code, rate);
}

// ─── Daily target queries ──────────────────────────────────────────────────────

function saveDailyTarget(date, routeId, targetAmount) {
  db.prepare(`
    INSERT INTO daily_targets (date, route_id, target_amount)
    VALUES (?, ?, ?)
    ON CONFLICT(date, route_id) DO UPDATE SET
      target_amount = excluded.target_amount
  `).run(date, routeId, targetAmount);
}

function getDailyTarget(date, routeId) {
  return db.prepare(
    'SELECT * FROM daily_targets WHERE date = ? AND route_id = ?'
  ).get(date, routeId) || null;
}

// ─── Arqueo queries ────────────────────────────────────────────────────────────

function saveArqueo(userId, routeId, date, denominations, totalNio) {
  return db.prepare(`
    INSERT INTO arqueos (user_id, route_id, date, denominations, total_nio)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, routeId, date, denominations, totalNio);
}

function getLastArqueo(userId) {
  return db.prepare(`
    SELECT a.*, r.name AS route_name
    FROM arqueos a
    LEFT JOIN routes r ON a.route_id = r.id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
    LIMIT 1
  `).get(userId) || null;
}

function getRecentArqueos(limit) {
  return db.prepare(`
    SELECT a.*, r.name AS route_name,
           u.first_name AS user_name, u.username AS user_username
    FROM arqueos a
    LEFT JOIN routes r ON a.route_id = r.id
    LEFT JOIN users u  ON a.user_id  = u.id
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(limit || 10);
}

module.exports = {
  getUser,
  createUser,
  updateUserRole,
  updateUserRoute,
  getAllUsers,
  getPendingUsers,
  getRoutes,
  createRoute,
  getCurrencyRates,
  upsertCurrencyRate,
  saveDailyTarget,
  getDailyTarget,
  saveArqueo,
  getLastArqueo,
  getRecentArqueos,
};
