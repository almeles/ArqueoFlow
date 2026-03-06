'use strict';

const Database = require('better-sqlite3');

let db;

function getDb() {
  if (!db) {
    db = new Database(process.env.DB_PATH || 'arqueoflow.db');
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id       INTEGER PRIMARY KEY,
      state         TEXT    NOT NULL DEFAULT 'idle',
      monto_planilla REAL,
      return_count  INTEGER,
      return_amount REAL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getSession(chatId) {
  const row = getDb()
    .prepare('SELECT * FROM sessions WHERE chat_id = ?')
    .get(chatId);
  return row || null;
}

function upsertSession(chatId, fields) {
  const existing = getSession(chatId);
  if (existing) {
    const sets = Object.keys(fields)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    getDb()
      .prepare(
        `UPDATE sessions SET ${sets}, updated_at = datetime('now') WHERE chat_id = @chat_id`
      )
      .run({ ...fields, chat_id: chatId });
  } else {
    const cols = ['chat_id', ...Object.keys(fields)].join(', ');
    const vals = ['@chat_id', ...Object.keys(fields).map((k) => `@${k}`)].join(', ');
    getDb()
      .prepare(`INSERT INTO sessions (${cols}) VALUES (${vals})`)
      .run({ ...fields, chat_id: chatId });
  }
}

function deleteSession(chatId) {
  getDb().prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId);
}

module.exports = { getSession, upsertSession, deleteSession };
