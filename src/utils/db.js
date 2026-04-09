/**
 * Вспомогательные функции для работы с БД
 * Убирают дублирование кода в маршрутах
 */

const db = require('../../config/database');

/**
 * Проверяет существование пользователя по ID
 * @param {number} userId
 * @returns {Promise<{exists: boolean, user?: Object}>}
 */
function checkUserExists(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, username, display_name, avatar FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) return reject(err);
      if (!user) return resolve({ exists: false });
      resolve({ exists: true, user });
    });
  });
}

/**
 * Получает пользователя по ID (без пароля)
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
function getUserById(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, username, display_name, avatar, bio, status, e2e_public_key, created_at FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) return reject(err);
      resolve(user || null);
    });
  });
}

/**
 * Получает пользователя по username (без пароля)
 * @param {string} username
 * @returns {Promise<Object|null>}
 */
function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, username, display_name, avatar, bio, status, e2e_public_key, created_at FROM users WHERE username = ?', [username], (err, user) => {
      if (err) return reject(err);
      resolve(user || null);
    });
  });
}

/**
 * Обёртка над db.run для INSERT/UPDATE/DELETE
 * Возвращает Promise с { lastID, changes }
 */
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Обёртка над db.get для SELECT одного результата
 */
function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Обёртка над db.all для SELECT нескольких результатов
 */
function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Безопасный счётчик записей
 */
function dbCount(table, whereClause = '', params = []) {
  const where = whereClause ? `WHERE ${whereClause}` : '';
  return dbGet(`SELECT COUNT(*) as count FROM ${table} ${where}`, params)
    .then(row => row ? row.count : 0);
}

module.exports = {
  checkUserExists,
  getUserById,
  getUserByUsername,
  dbRun,
  dbGet,
  dbAll,
  dbCount
};
