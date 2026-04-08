# 📦 Что было установлено и изменено

> Этот файл — список всех изменений и установленных пакетов.
> Если хочешь всё снести до оригинального состояния — читай ниже.

---

## Установленные npm-пакеты (новые)

| Пакет | Зачем | Удалить командой |
|---|---|---|
| `cookie-parser` | Чтение httpOnly cookies | `npm uninstall cookie-parser` |
| `express-rate-limit` | Rate limiting (защита от брутфорса) | `npm uninstall express-rate-limit` |
| `helmet` | Security headers (CSP, X-Frame-Options и т.д.) | `npm uninstall helmet` |
| `jest` (dev) | Фреймворк для тестирования | `npm uninstall jest` |
| `supertest` (dev) | HTTP-тестирование Express | `npm uninstall supertest` |

---

## Созданные новые файлы

| Файл | Зачем |
|---|---|
| `.gitignore` | Исключение `.env`, `*.sqlite`, `node_modules/` из git |
| `.env.example` | Шаблон переменных окружения для установки |
| `INSTALLED.md` | Этот файл |
| `__tests__/api.test.js` | Базовые тесты API (register, login) |

---

## Изменённые файлы

### Сервер
| Файл | Что изменено |
|---|---|
| `server.js` | Добавлены: helmet, rate limiting, cookie-parser, CORS с credentials, graceful shutdown, `/health` endpoint |
| `.env` | JWT_SECRET заменён на случайный 128-символьный ключ |

### База данных
| Файл | Что изменено |
|---|---|
| `config/database.js` | Добавлены индексы (messages, friendships, wall_posts, post_comments), таблица `post_likes` |

### Middleware
| Файл | Что изменено |
|---|---|
| `src/middleware/auth.js` | Убран хардкод fallback JWT_SECRET, добавлена проверка cookie + заголовок, валидация длины ключа |
| `src/middleware/upload.js` | Добавлена проверка magic bytes через `openSync/readSync` (не читает весь файл), экспорт `{ upload, validateImageMagic }` |
| `src/middleware/upload-media.js` | Добавлена проверка magic bytes для аудио/видео, экспорт `{ upload, validateMediaMagic }` |

### Роуты
| Файл | Что изменено |
|---|---|
| `src/routes/auth.routes.js` | Токен в httpOnly cookie вместо JSON, добавлен `POST /api/logout`, пароль мин. 8 символов, валидация username regex |
| `src/routes/user.routes.js` | Валидация ID, проверка что не свой профиль через `/api/users/:id`, удаление старой аватарки, `validateImageMagic` |
| `src/routes/friend.routes.js` | Валидация `friendId`, проверка существования пользователя, строгое сравнение `===` |
| `src/routes/message.routes.js` | `validateMediaMagic`, курсорная пагинация `?cursor=&limit=` |
| `src/routes/wall.routes.js` | Пагинация `?offset=&limit=`, проверка лайков через `post_likes` таблицу, `p.liked` флаг, эндпоинт `/api/wall/feed` |

### Socket.IO
| Файл | Что изменено |
|---|---|
| `src/socket/socket.js` | JWT middleware для Socket.IO, rate limiting (10 сообщ/мин), `senderId` из токена, проверка существования receiverId, чтение токена из cookie |

### Фронтенд
| Файл | Что изменено |
|---|---|
| `public/js/auth.js` | Убрано хранение токена в localStorage, добавлен `credentials: 'include'` |
| `public/js/dashboard.js` | Проверка авторизации через `/api/profile` вместо localStorage |
| `public/js/modules/api.js` | Убран `Authorization` заголовок, добавлен `credentials: 'include'`, редирект при 401/403 |
| `public/js/modules/utils.js` | Убран `userId` из localStorage, добавлены getter'ы через `window`, `sanitizeUrl()`, Socket.IO с `credentials: true` |
| `public/js/modules/navigation.js` | Logout через `POST /api/logout` + очистка cookie |
| `public/js/modules/messages.js` | `sanitizeUrl()` для всех URL, убран `senderId` из socket вызовов |
| `public/js/modules/profile.js` | Поддержка `{ posts, hasMore, liked }` формата стены, `sanitizeUrl` для аватаров |
| `public/js/modules/handlers.js` | Обработка ошибки «Вы уже лайкнули этот пост» |
| `public/index.html` | Авто-редирект на dashboard если уже авторизован |

---

## 🗑️ Как всё удалить и вернуть к оригиналу

### 1. Удалить установленные пакеты:
```bash
npm uninstall cookie-parser express-rate-limit helmet
```

### 2. Удалить созданные файлы:
```
Удалить: .gitignore, .env.example, INSTALLED.md
```

### 3. Вернуть `.env`:
```
PORT=3000
JWT_SECRET=t1-social-network-secret-key-2024
```

### 4. Вернуть все изменённые файлы через git:
```bash
git checkout -- server.js src/ public/
```
(если проект под git)

### 5. Или переустановить зависимости:
```bash
rm -rf node_modules package-lock.json
npm install
```
Это вернёт зависимости к состоянию `package.json` (но ручные изменения в файлах придётся откатить вручную).

---

## 💡 Для бесплатного хостинга

### Рекомендуемые платформы:

| Платформа | URL | Бесплатный лимит |
|---|---|---|
| **Render** | render.com | 750 часов/мес, PostgreSQL бесплатно |
| **Railway** | railway.app | $5 кредитов/мес, PostgreSQL бесплатно |
| **Glitch** | glitch.com | Бесплатно, но засыпает через 5 мин |
| **Replit** | replit.com | Бесплатно, но медленно |

### Что нужно для хостинга:

1. **SQLite НЕ подходит для Render/Railway** — файловая система эфемерная (файлы удаляются при перезапуске).
   - Нужно мигрировать на PostgreSQL (или использовать внешний SQLite хостинг, например turso.cloud — бесплатно 9GB)
   
2. **Для бесплатного хостинга с SQLite** подойдёт:
   - **Glitch** — поддерживает SQLite, но засыпает
   - **VPS бесплатно** — Oracle Cloud даёт 4 ARM ядра + 24GB RAM бесплатно навсегда
   - **Fly.io** — 3 маленьких VM бесплатно, но нужен PostgreSQL

3. **Самый простой вариант** — Render + бесплатный PostgreSQL:
   - Render даст бесплатный PostgreSQL
   - Нужно будет заменить `sqlite3` на `pg` в коде

### Текущие зависимости НЕ для продакшена:
- `sqlite3` — работает только с файловой системой (не подходит для Render/Railway)
- `bcrypt` — может долго компилироваться на слабых хостингах (но работает)
