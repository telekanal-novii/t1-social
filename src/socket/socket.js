/**
 * Socket.IO — сообщения в реальном времени
 */
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { encrypt } = require('../utils/crypto');

/** @type {Map<number, string>} userId -> socketId */
const connectedUsers = new Map();

/** @type {Map<number, { count: number, resetAt: number }>} userId -> rate limit state */
const socketRateLimits = new Map();

const SOCKET_RATE_LIMIT = 10; // макс. сообщений
const SOCKET_RATE_WINDOW = 60 * 1000; // 1 минута

/**
 * Проверяет rate limit для socket событий
 * @param {number} userId
 * @returns {boolean} — true если лимит превышен
 */
function checkSocketRateLimit(userId) {
  const now = Date.now();
  const state = socketRateLimits.get(userId);

  if (!state || now > state.resetAt) {
    socketRateLimits.set(userId, { count: 1, resetAt: now + SOCKET_RATE_WINDOW });
    return false;
  }

  state.count++;
  return state.count > SOCKET_RATE_LIMIT;
}

/**
 * Socket.IO middleware — проверяет JWT токен при подключении
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {Function} next
 */
function socketAuth(io, socket, next) {
  // Пробуем токен из auth (клиент может передать через auth option)
  let token = socket.handshake.auth.token;

  // Или из query
  if (!token) {
    token = socket.handshake.query.token;
  }

  // Или из cookie (теперь основной метод)
  if (!token && socket.handshake.headers.cookie) {
    const cookies = socket.handshake.headers.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'token') {
        token = decodeURIComponent(value);
        break;
      }
    }
  }

  if (!token) {
    return next(new Error('Требуется авторизация'));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error('Неверный токен'));
    }
    socket.user = decoded; // { id, username }
    next();
  });
}

/**
 * Настраивает обработчики Socket.IO
 * @param {import('socket.io').Server} io
 * @param {import('sqlite3').Database} db
 * @returns {Map} Map подключённых пользователей
 */
function setupSocket(io, db) {
  // Регистрация middleware для аутентификации
  io.use((socket, next) => socketAuth(io, socket, next));

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`🔌 Подключён: ${socket.id} (user: ${userId})`);

    // Автоматически регистрируем пользователя при подключении
    connectedUsers.set(Number(userId), socket.id);
    io.emit('user_status', { userId: Number(userId), status: 'online' });

    socket.on('send_message', (data) => {
      const { receiverId, content, type = 'text', fileUrl = '' } = data;
      const senderId = socket.user.id;

      if (!receiverId) return;
      if (receiverId == senderId) return;
      if ((!content && !fileUrl)) return;

      // Rate limit проверка
      if (checkSocketRateLimit(senderId)) {
        socket.emit('error', { message: 'Слишком много сообщений, подождите' });
        return;
      }

      // Проверяем что получатель существует
      db.get('SELECT id FROM users WHERE id = ?', [receiverId], (err, user) => {
        if (err || !user) {
          socket.emit('error', { message: 'Получатель не найден' });
          return;
        }

        db.run(
        'INSERT INTO messages (sender_id, receiver_id, content, type, file_url) VALUES (?, ?, ?, ?, ?)',
        [senderId, receiverId, encrypt(content || ''), type, encrypt(fileUrl || '')],
        function (err) {
          if (err) {
            console.error('❌ Ошибка сохранения сообщения:', err.message);
            return;
          }
          const msg = {
            id: this.lastID,
            sender_id: senderId,
            receiver_id: receiverId,
            content,
            type,
            file_url: fileUrl,
            is_read: 0,
            created_at: new Date().toISOString()
          };

          const receiverSocketId = connectedUsers.get(Number(receiverId));
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('new_message', msg);
          }
          socket.emit('message_sent', msg);
        }
      );
      });
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(Number(userId));
      db.run("UPDATE users SET status = 'offline' WHERE id = ?", [userId]);
      io.emit('user_status', { userId: Number(userId), status: 'offline' });
      console.log(`🔌 Отключён: пользователь ${userId}`);
    });
  });

  return connectedUsers;
}

module.exports = { setupSocket, connectedUsers };
