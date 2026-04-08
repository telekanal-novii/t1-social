/**
 * API Helper — обёртка над fetch с обработкой ошибок
 */

/**
 * Выполняет авторизованный запрос к API
 * Токен передаётся автоматически через httpOnly cookie
 * @template T
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<T>}
 */
async function api(url, opts = {}) {
  const headers = {
    'Cache-Control': 'no-cache',
    ...opts.headers
  };

  // Не добавляем Content-Type для FormData
  if (opts.body && !(opts.body instanceof FormData) && !opts.headers?.['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...opts,
    headers,
    credentials: 'include' // отправляем cookie автоматически
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ошибка сервера' }));
    // Если 401/403 — сессия истекла, чистим ВСЁ
    if (res.status === 401 || res.status === 403) {
      // Чистим localStorage но сохраняем настройки темы если есть
      const theme = localStorage.getItem('theme');
      localStorage.clear();
      if (theme) localStorage.setItem('theme', theme);
      // Удаляем куки токена
      document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
      window.location.href = '/';
    }
    throw new Error(err.error || 'Неизвестная ошибка');
  }

  return res.json();
}
