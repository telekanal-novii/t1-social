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
    // Если 401/403 — возможно сессия истекла
    if (res.status === 401 || res.status === 403) {
      localStorage.clear();
      window.location.href = '/';
    }
    throw new Error(err.error || 'Неизвестная ошибка');
  }

  return res.json();
}
