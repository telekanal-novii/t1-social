/**
 * Утилиты форматирования времени (Московский часовой пояс, UTC+3)
 * Клиентская версия — используется в profile.js и messages.js
 */

/**
 * Парсит строку даты из SQLite (YYYY-MM-DD HH:MM:SS) как UTC
 * @param {string} str
 * @returns {Date}
 */
window.parseUTC = function(str) {
  return new Date(str.replace(' ', 'T') + 'Z');
};

/** Опции форматирования для полной даты и времени */
const MOSCOW_DT = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' };

/** Опции форматирования для даты и времени (без года) */
const MOSCOW_TIME = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' };

/** Опции форматирования для часов */
const MOSCOW_CLOCK = { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' };
