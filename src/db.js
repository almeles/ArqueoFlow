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

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id         INTEGER PRIMARY KEY,
    username        TEXT,
    assigned_routes TEXT    NOT NULL DEFAULT '[]',
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS action_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    action     TEXT    NOT NULL,
    details    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS route_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    planilla   REAL    NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
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
 * Update the status of multiple arqueos at once.
 *
 * @param {number[]} ids
 * @param {string}   status
 * @returns {number}  Total rows changed.
 */
function bulkUpdateArqueoStatus(ids, status) {
  if (!ids || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  return db
    .prepare(`UPDATE arqueos SET status = ? WHERE id IN (${placeholders})`)
    .run(status, ...ids)
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
 * Get weekly stats for historical trends.
 *
 * @param {number} [weeks=4]  Number of recent ISO weeks to include.
 * @returns {Array<{week: string, status: string, count: number, total_amount: number}>}
 */
function getWeeklyStats(weeks = 4) {
  return db
    .prepare(`
      SELECT strftime('%Y-W%W', created_at) AS week,
             status,
             COUNT(*)          AS count,
             SUM(total_caja)   AS total_amount
      FROM   arqueos
      GROUP  BY week, status
      ORDER  BY week DESC
      LIMIT  ?
    `)
    .all(weeks * 6);
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

/**
 * Retrieve arqueos filtered by optional criteria.
 *
 * @param {Object}      [opts]
 * @param {number|null} [opts.chatId]
 * @param {string|null} [opts.status]
 * @param {string|null} [opts.from]   ISO date string 'YYYY-MM-DD'
 * @param {string|null} [opts.to]     ISO date string 'YYYY-MM-DD'
 * @param {string|null} [opts.route]
 * @param {number}      [opts.limit=50]
 * @returns {Array<Object>}
 */
function getArqueosByFilter({ chatId = null, status = null, from = null, to = null, route = null, limit = 50 } = {}) {
  const conditions = [];
  const params = [];

  if (chatId !== null) { conditions.push('chat_id = ?');                 params.push(chatId); }
  if (status)          { conditions.push('status = ?');                  params.push(status); }
  if (route)           { conditions.push('route = ?');                   params.push(route);  }
  if (from)            { conditions.push("date(created_at) >= date(?)"); params.push(from);   }
  if (to)              { conditions.push("date(created_at) <= date(?)"); params.push(to);     }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit);
  return db
    .prepare(`SELECT * FROM arqueos ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params);
}

/**
 * Return unreviewed arqueos with an absolute discrepancy above a threshold.
 *
 * @param {number} [threshold=0]
 * @param {number} [limit=10]
 * @returns {Array<Object>}
 */
function getDiscrepancies(threshold = 0, limit = 10) {
  return db
    .prepare(`
      SELECT * FROM arqueos
      WHERE  ABS(diff) > ?
        AND  status NOT IN ('aprobado', 'rechazado')
      ORDER  BY ABS(diff) DESC
      LIMIT  ?
    `)
    .all(threshold, limit);
}

// ---------------------------------------------------------------------------
// User management helpers
// ---------------------------------------------------------------------------

/**
 * Insert or update a user record.
 *
 * @param {number}      chatId
 * @param {string|null} username
 * @param {string[]}    assignedRoutes  Empty array means unrestricted.
 */
function upsertUser(chatId, username, assignedRoutes) {
  const routesJson = JSON.stringify(Array.isArray(assignedRoutes) ? assignedRoutes : []);
  db.prepare(`
    INSERT INTO users (chat_id, username, assigned_routes)
    VALUES (@chatId, @username, @routesJson)
    ON CONFLICT(chat_id) DO UPDATE SET
      username        = excluded.username,
      assigned_routes = excluded.assigned_routes
  `).run({ chatId, username: username || null, routesJson });
}

/**
 * Retrieve a single user record.
 *
 * @param {number} chatId
 * @returns {Object|undefined}  Row with `assigned_routes` parsed as Array.
 */
function getUser(chatId) {
  const row = db.prepare('SELECT * FROM users WHERE chat_id = ?').get(chatId);
  if (row) {
    row.assigned_routes = JSON.parse(row.assigned_routes || '[]');
  }
  return row;
}

/**
 * Retrieve all user records.
 *
 * @returns {Array<Object>}  Each row has `assigned_routes` parsed as Array.
 */
function getAllUsers() {
  return db
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all()
    .map(r => ({ ...r, assigned_routes: JSON.parse(r.assigned_routes || '[]') }));
}

/**
 * Set the active/inactive flag for a user.
 *
 * @param {number}  chatId
 * @param {boolean} isActive
 * @returns {number}  Rows changed.
 */
function setUserActive(chatId, isActive) {
  return db
    .prepare('UPDATE users SET is_active = ? WHERE chat_id = ?')
    .run(isActive ? 1 : 0, chatId)
    .changes;
}

/**
 * Check whether a user is allowed to submit an arqueo for a given route.
 *
 * Rules:
 *  - No user record → allowed (backward compatibility).
 *  - Inactive user  → denied.
 *  - Empty assigned_routes → allowed (unrestricted).
 *  - Otherwise the route string must appear in assigned_routes.
 *
 * @param {number}       chatId
 * @param {string|number} route
 * @returns {boolean}
 */
function canUserAccessRoute(chatId, route) {
  const user = getUser(chatId);
  if (!user) return true;
  if (!user.is_active) return false;
  if (user.assigned_routes.length === 0) return true;
  return user.assigned_routes.includes(String(route));
}

// ---------------------------------------------------------------------------
// Action logging
// ---------------------------------------------------------------------------

/**
 * Record an action in the audit log.
 *
 * @param {number}      chatId
 * @param {string}      action
 * @param {Object|null} [details]
 */
function logAction(chatId, action, details) {
  db.prepare('INSERT INTO action_logs (chat_id, action, details) VALUES (?, ?, ?)')
    .run(chatId, action, details ? JSON.stringify(details) : null);
}

/**
 * Retrieve recent action-log entries.
 *
 * @param {Object}      [opts]
 * @param {number|null} [opts.chatId]
 * @param {number}      [opts.limit=20]
 * @returns {Array<Object>}
 */
function getActionLogs({ chatId = null, limit = 20 } = {}) {
  if (chatId !== null) {
    return db
      .prepare('SELECT * FROM action_logs WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(chatId, limit);
  }
  return db
    .prepare('SELECT * FROM action_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

// ---------------------------------------------------------------------------
// Route templates
// ---------------------------------------------------------------------------

/**
 * Save a new route template.
 *
 * @param {string} name
 * @param {number} planilla
 * @returns {number}  Auto-generated row id.
 */
function saveRouteTemplate(name, planilla) {
  return db
    .prepare('INSERT INTO route_templates (name, planilla) VALUES (?, ?)')
    .run(name, planilla)
    .lastInsertRowid;
}

/**
 * Retrieve all route templates ordered by name.
 *
 * @returns {Array<Object>}
 */
function getRouteTemplates() {
  return db
    .prepare('SELECT * FROM route_templates ORDER BY name ASC')
    .all();
}

/**
 * Delete a route template by id.
 *
 * @param {number} id
 * @returns {number}  Rows deleted.
 */
function deleteRouteTemplate(id) {
  return db
    .prepare('DELETE FROM route_templates WHERE id = ?')
    .run(id)
    .changes;
}

// ---------------------------------------------------------------------------
// Settings (key/value store)
// ---------------------------------------------------------------------------

/**
 * Retrieve a settings value.
 *
 * @param {string}      key
 * @param {string|null} [defaultValue=null]
 * @returns {string|null}
 */
function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

/**
 * Persist (upsert) a settings value.
 *
 * @param {string}       key
 * @param {string|number} value
 */
function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

module.exports = {
  saveArqueo,
  getHistory,
  getAllArqueos,
  getArqueoById,
  updateArqueoStatus,
  bulkUpdateArqueoStatus,
  getStats,
  getWeeklyStats,
  getUnreviewedArqueos,
  getArqueosByFilter,
  getDiscrepancies,
  upsertUser,
  getUser,
  getAllUsers,
  setUserActive,
  canUserAccessRoute,
  logAction,
  getActionLogs,
  saveRouteTemplate,
  getRouteTemplates,
  deleteRouteTemplate,
  getSetting,
  setSetting,
};
