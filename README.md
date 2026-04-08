# Т1 Сеть — Локальная социальная сеть

Современная социальная сеть для локального использования с упором на производительность и безопасность.

## Возможности

### Основное
- ✅ Регистрация и авторизация (JWT в httpOnly cookies)
- ✅ SPA-роутинг (`/feed`, `/people`, `/profile` и т.д.)
- ✅ Профили с обложкой, аватаром и био
- ✅ Модальное окно редактирования профиля

### Социальное взаимодействие
- ✅ Система дружбы (заявки, принятие, отклонение)
- ✅ Персональные стены с постами
- ✅ Лайки постов (оптимистичный UI — мгновенный отклик)
- ✅ Комментарии под постами (предпросмотр первых 3-х)
- ✅ Удаление своих постов и комментариев

### Мессенджер
- ✅ Личные сообщения в реальном времени (WebSocket)
- ✅ Drag & Drop загрузка файлов в чат
- ✅ Поддержка: Изображения, Аудио, Видео
- ✅ Встроенный медиа-плеер (зум фото, таймлайн аудио)
- ✅ Удаление всей переписки

### Интерфейс
- ✅ Статусы онлайн/оффлайн в реальном времени
- ✅ Уведомления и счётчики (заявки, сообщения)
- ✅ Аккордеон заявок в друзья
- ✅ Темная тема и современный дизайн

## Безопасность

- 🔒 **JWT в httpOnly cookies** — токен недоступен для XSS-атак через JavaScript
- 🔒 **Socket.IO аутентификация** — каждое WebSocket-подключение проверяет JWT токен
- 🔒 **Rate limiting** — защита от брутфорса (10 попыток входа за 15 мин)
- 🔒 **Magic bytes валидация** — файлы проверяются по сигнатурам, а не только по расширению
- 🔒 **Content-Security-Policy** — через Helmet (X-Frame-Options, XSS-защита и др.)
- 🔒 **Санитизация URL** — блокировка `javascript:`/`data:` URI
- 🔒 **Параметризованные SQL-запросы** — защита от SQL-инъекций
- 🔒 **Валидация входных данных** — проверка ID, длины контента, существования пользователей

## Технологический стек

- **Backend:** Node.js + Express
- **База данных:** SQLite
- **Реальное время:** Socket.IO
- **Аутентификация:** JWT (httpOnly cookies)
- **Безопасность:** Helmet, express-rate-limit, cookie-parser
- **Фронтенд:** Vanilla HTML/CSS/JS (Модульная ES-подобная архитектура через `<script>` теги)

## Установка и запуск

### Требования
- Node.js ≥ 16
- npm

### Настройка

1. Скопируй `.env.example` в `.env`:
```bash
cp .env.example .env
```

2. Сгенерируй случайный `JWT_SECRET` (минимум 32 символа):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

3. Вставь полученный ключ в `.env`

### Запуск

```bash
npm install          # установка зависимостей
npm start            # запуск сервера
```

Откройте: `http://localhost:3000`

### Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `PORT` | Порт сервера | `3000` |
| `JWT_SECRET` | Секретный ключ JWT (мин. 32 символа) | — |
| `NODE_ENV` | Окружение (`development` / `production`) | `development` |
| `ALLOWED_ORIGIN` | Разрешённый CORS-домен (для продакшена) | `http://localhost:3000` |

## Как пользоваться

### 1. Лента
Главная страница показывает ленту всех постов пользователей, отсортированную по дате. Посты можно лайкать и комментировать.

### 2. Люди
Каталог пользователей с поиском. Клик по имени или аватару открывает профиль пользователя.

### 3. Сообщения
Мгновенный обмен сообщениями. Можно перетаскивать файлы прямо в окно чата или использовать кнопку скрепки.
- **Фото:** Открываются в просмотрщике с возможностью зума колесиком мыши.
- **Аудио:** Встроенный плеер с таймлайном.

### 4. Статусы
Зеленая точка означает, что пользователь сейчас онлайн. Статус обновляется мгновенно при входе/выходе.

## Структура проекта

```
T1 Сеть/
├── .env                      # Настройки (НЕ добавлять в git!)
├── .env.example              # Шаблон переменных окружения
├── .gitignore                # Исключения для git
├── server.js                 # Точка входа
├── database.sqlite           # БД (создаётся авто, не в git)
├── package.json
│
├── config/
│   └── database.js           # Инициализация БД и миграции
│
├── src/
│   ├── middleware/
│   │   ├── auth.js           # JWT проверка + cookie
│   │   ├── upload.js         # Multer (аватары) + magic bytes
│   │   └── upload-media.js   # Multer (медиа для чата) + magic bytes
│   ├── routes/
│   │   ├── auth.routes.js    # /api/register, /login, /logout
│   │   ├── user.routes.js    # /api/profile, /users
│   │   ├── friend.routes.js  # /api/friends/*
│   │   ├── message.routes.js # /api/messages, /conversations
│   │   └── wall.routes.js    # /api/wall (посты, лайки, комменты)
│   └── socket/
│       └── socket.js         # Socket.IO логика + JWT middleware
│
└── public/
    ├── index.html            # Вход / Регистрация
    ├── dashboard.html        # SPA-дашборд
    ├── css/
    │   ├── auth.css
    │   └── dashboard.css     # Стили
    ├── js/
    │   ├── dashboard.js      # Точка входа
    │   ├── auth.js           # Авторизация (cookie)
    │   └── modules/
    │       ├── utils.js      # Ядро (state, $, notify, avatarHTML, sanitizeUrl)
    │       ├── api.js        # Обёртка над fetch (credentials: include)
    │       ├── navigation.js # Роутинг + logout
    │       ├── profile.js    # Профиль, Лента, Стена
    │       ├── friends.js    # Друзья
    │       ├── messages.js   # Мессенджер, Медиа, Drag&Drop
    │       ├── userProfile.js # Чужие профили
    │       └── handlers.js   # Глобальные обработчики кликов
    ├── media/                # Загруженные файлы из чата
    └── avatars/              # Аватарки
```

## API Endpoints

| Метод | Маршрут | Описание |
|---|---|---|
| `POST` | `/api/register` | Регистрация (httpOnly cookie) |
| `POST` | `/api/login` | Авторизация (httpOnly cookie) |
| `POST` | `/api/logout` | Выход (удаление cookie) |
| `GET` | `/api/profile` | Свой профиль |
| `PUT` | `/api/profile` | Обновить профиль |
| `PUT` | `/api/profile/avatar` | Загрузить аватар (magic bytes) |
| `GET` | `/api/users` | Все пользователи |
| `GET` | `/api/users/:id` | Профиль пользователя |
| `GET` | `/api/friends/statuses` | Статусы дружбы |
| `GET` | `/api/friends` | Список друзей |
| `GET` | `/api/friends/requests` | Заявки в друзья |
| `POST` | `/api/friends/request` | Отправить заявку |
| `PUT` | `/api/friends/accept/:id` | Принять заявку |
| `DELETE` | `/api/friends/reject/:id` | Отклонить заявку |
| `DELETE` | `/api/friends/:id` | Удалить друга |
| `GET` | `/api/conversations` | Все диалоги |
| `POST` | `/api/messages/upload` | Загрузить файл (magic bytes) |
| `DELETE` | `/api/messages/:userId` | Удалить переписку |
| `GET` | `/api/wall/:userId` | Посты стены |
| `POST` | `/api/wall/:userId` | Создать пост |
| `POST` | `/api/wall/like/:postId` | Лайкнуть пост |
| `DELETE` | `/api/wall/like/:postId` | Убрать лайк |
| `DELETE` | `/api/wall/:postId` | Удалить пост |
| `GET` | `/api/wall/post/:postId/comments` | Комментарии |
| `POST` | `/api/wall/post/:postId/comments` | Добавить комментарий |
| `DELETE` | `/api/wall/comment/:commentId` | Удалить комментарий |

## Маршруты SPA

| URL | Описание |
|---|---|
| `/feed` | Лента постов |
| `/people` | Каталог пользователей |
| `/profile` | Свой профиль |
| `/friends` | Друзья и заявки |
| `/messages` | Сообщения |
| `/<username>` | Профиль другого пользователя |

## Лицензия

MIT