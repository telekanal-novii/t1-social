/**
 * Утилиты и глобальное состояние
 */

/** @type {Object} Глобальное состояние приложения */
const state = {
  chatUserId: null,
  usersCache: [],
  friendStatuses: {},
  likedPosts: new Set(JSON.parse(localStorage.getItem('likedPosts') || '[]')),
};

/**
 * Текущий пользователь — читается из window.currentUserId
 * (устанавливается в dashboard.js после загрузки /api/profile).
 * Для обратной совместимости — глобальный getter.
 */
Object.defineProperty(window, 'userId', {
  get() { return window.currentUserId || null; },
  configurable: true
});

Object.defineProperty(window, 'username', {
  get() { return window.currentUsername || null; },
  configurable: true
});

/**
 * Socket.IO — подключаемся с credentials для отправки cookie.
 * Сервер читает токен из httpOnly cookie автоматически.
 */
const socket = io({
  credentials: true
});

// Индикатор статуса подключения
let connectionStatusEl = null;

function createConnectionIndicator() {
  if (connectionStatusEl) return;
  connectionStatusEl = document.createElement('div');
  connectionStatusEl.id = 'connection-indicator';
  connectionStatusEl.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;background:#fbbf24;color:#000;box-shadow:0 2px 10px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none;';
  connectionStatusEl.textContent = '🔄 Переподключение...';
  connectionStatusEl.style.display = 'none';
  document.body.appendChild(connectionStatusEl);
}

socket.on('connect', () => {
  console.log('[socket] Подключено');
  if (connectionStatusEl) {
    connectionStatusEl.style.opacity = '0';
    setTimeout(() => { if (connectionStatusEl) connectionStatusEl.style.display = 'none'; }, 300);
  }
  // Обновляем UI — показываем что соединение восстановлено
  const indicator = $('#connection-indicator');
  if (indicator && indicator.style.display === 'block') {
    notify('Соединение восстановлено', 'success');
  }
});

socket.on('disconnect', (reason) => {
  console.log('[socket] Отключено:', reason);
  createConnectionIndicator();
  connectionStatusEl.style.display = 'block';
  connectionStatusEl.style.opacity = '1';
});

socket.on('connect_error', (err) => {
  console.error('[socket] Ошибка подключения:', err.message);
  if (err.message === 'Неверный токен' || err.message === 'Требуется авторизация') {
    notify('Сессия истекла. Перезагрузка...', 'error');
    setTimeout(() => { window.location.href = '/'; }, 2000);
  } else {
    // Показываем пользователю что соединение потеряно
    createConnectionIndicator();
    connectionStatusEl.style.display = 'block';
    connectionStatusEl.style.opacity = '1';
  }
});

socket.on('reconnect', (attempt) => {
  console.log('[socket] Переподключено после', attempt, 'попыток');
  if (attempt > 1) {
    notify(`✓ Переподключено (попытка ${attempt})`, 'success');
  }
});

socket.on('reconnect_failed', () => {
  console.error('[socket] Переподключение не удалось');
  notify('✗ Не удалось переподключиться. Обновите страницу.', 'error');
});

/**
 * Экранирует HTML для безопасности
 * @param {string} t
 * @returns {string}
 */
const esc = t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };

/**
 * Находит URL в тексте и оборачивает в <a>
 * @param {string} text — исходный текст (НЕ экранированный)
 * @returns {string} — HTML с кликабельными ссылками
 */
function linkifyText(text) {
  if (!text) return '';
  // Экранируем HTML сначала
  const escaped = esc(text);
  
  // Regex для URL (поддерживает http, https, ftp, www)
  const urlRegex = /(?:(?:https?|ftp):\/\/|www\.)[^\s<>"{}]+(?:\([^)]*\)|[^\s<()"{}])*/gi;
  
  return escaped.replace(urlRegex, (url) => {
    // Если URL уже содержит < или > (значит уже в HTML) — пропускаем
    if (url.includes('<') || url.includes('>')) return url;
    
    const href = url.startsWith('www.') ? 'https://' + url : url;
    const display = url.length > 60 ? url.substring(0, 57) + '...' : url;
    return `<a href="${sanitizeUrl(href)}" target="_blank" rel="noopener noreferrer" class="post-link">${display}</a>`;
  });
}

/**
 * Санитизирует URL — блокирует javascript:, data:, vbscript: URI
 * @param {string} url
 * @returns {string}
 */
function sanitizeUrl(url) {
  if (!url) return '';
  // Разрешаем только относительные пути и http(s) URL
  const cleaned = url.trim();
  if (/^(javascript|data|vbscript|blob):/i.test(cleaned)) {
    console.warn('Blocked dangerous URL:', url);
    return '';
  }
  return cleaned;
}

/**
 * Получает инициалы имени
 * @param {string} n
 * @returns {string}
 */
const initials = n => n.charAt(0).toUpperCase();

/**
 * Быстрый querySelector
 * @param {string} sel
 * @param {Document|Element} [ctx]
 * @returns {Element|null}
 */
const $ = (sel, ctx = document) => ctx.querySelector(sel);

/**
 * Быстрый querySelectorAll → Array
 * @param {string} sel
 * @param {Document|Element} [ctx]
 * @returns {Element[]}
 */
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/** Карта классов для аватарок разных размеров */
const avatarMap = {
  small: { img: 'list-item-avatar', ph: 'list-item-avatar-placeholder' },
  conversation: { img: 'conversation-avatar', ph: 'conversation-avatar-placeholder' },
  chat: { img: 'chat-user-avatar', ph: 'avatar-small-placeholder' },
};

/**
 * Генерирует HTML аватарки
 * @param {Object} user
 * @param {string} [size] - 'usercard' | 'small' | 'conversation' | 'chat' | 'normal'
 * @returns {string}
 */
function avatarHTML(user, size = 'normal') {
  const cls = size === 'usercard'
    ? { img: 'user-card-avatar', ph: 'user-card-avatar-placeholder' }
    : (avatarMap[size] || { img: 'user-card-avatar', ph: 'user-card-avatar-placeholder' });
  const inner = user.avatar
    ? `<img src="${sanitizeUrl(esc(user.avatar))}" alt="">`
    : initials(user.display_name || user.username);
  return user.avatar
    ? `<div class="${cls.img}">${inner}</div>`
    : `<div class="${cls.ph}">${inner}</div>`;
}

/** Сохраняет лайкнутые посты в localStorage */
function saveLikes() {
  localStorage.setItem('likedPosts', JSON.stringify([...state.likedPosts]));
}

/**
 * Показывает уведомление
 * @param {string} msg
 * @param {string} [type] - 'success' | 'error' | 'info'
 */
function notify(msg, type = 'success') {
  let container = $('#notifications-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notifications-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:360px;';
    document.body.appendChild(container);
  }

  const id = ++notify._id;
  const icons = {
    success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const el = document.createElement('div');
  el.id = `notif-${id}`;
  el.style.cssText = `pointer-events:auto;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);backdrop-filter:blur(8px);transform:translateX(120%);opacity:0;transition:transform .35s cubic-bezier(.4,0,.2,1),opacity .35s ease;`;
  el.innerHTML = `<div style="flex-shrink:0;margin-top:1px">${icons[type] || icons.info}</div><div style="flex:1;font-size:14px;font-weight:500;color:var(--text-primary);line-height:1.4">${esc(msg)}</div>`;
  container.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  }));

  setTimeout(() => {
    el.style.transform = 'translateX(120%)';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      const idx = container.children.length;
      if (idx === 0) container.remove();
    }, 350);
  }, 3500);
}
notify._id = 0;

/**
 * Загружает файл с отслеживанием прогресса
 * @param {string} url
 * @param {FormData} formData
 * @param {Function} onProgress — callback с (loaded, total)
 * @returns {Promise<Object>}
 */
window.uploadWithProgress = function(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.open('POST', url);
    xhr.withCredentials = true;
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    });
    
    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || 'Ошибка загрузки'));
        }
      } catch (err) {
        reject(new Error('Ошибка обработки ответа'));
      }
    });
    
    xhr.addEventListener('error', () => reject(new Error('Ошибка сети')));
    xhr.addEventListener('timeout', () => reject(new Error('Таймаут загрузки')));
    
    xhr.send(formData);
  });
};

// CSS анимации
if (!$('#slide-anim-style')) {
  const s = document.createElement('style');
  s.id = 'slide-anim-style';
  s.textContent = '@keyframes slideIn{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(400px);opacity:0}}@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}@keyframes bubbleIn{from{opacity:0;transform:translateY(12px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}';
  document.head.appendChild(s);
}

// Делаем linkifyText глобальной
window.linkifyText = linkifyText;

// ======================== УВЕДОМЛЕНИЯ В РЕАЛЬНОМ ВРЕМЕНИ ========================

// Debounce для уведомлений (не спамить одинаковыми)
const _notifTimers = {};
socket.on('notification', (data) => {
  const key = `${data.type}-${data.fromUserId}`;

  // Счётчик обновляем всегда (без debounce)
  if (data.type === 'friend_request' && typeof loadFriendRequestsCount === 'function') loadFriendRequestsCount();
  if (data.type === 'new_message' && typeof loadMessagesCount === 'function') loadMessagesCount();

  // А визуальное уведомление — с debounce
  if (_notifTimers[key]) return;
  _notifTimers[key] = setTimeout(() => delete _notifTimers[key], 5000);

  const msgs = {
    new_message: `${data.fromUsername || 'Пользователь'}: ${data.content?.substring(0, 60) || 'Новое сообщение'}`,
    friend_request: `${data.fromUsername || 'Пользователь'} хочет добавить вас в друзья`,
    friend_accepted: `${data.fromUsername || 'Пользователь'} принял вашу заявку`
  };
  if (msgs[data.type]) notify(msgs[data.type], 'info');
});
