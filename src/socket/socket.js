/**
 * Socket.IO — сообщения в реальном времени
 */
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { encrypt } = require('../utils/crypto');

/** @type {import('socket.io').Server} */
let ioInstance = null;

/** @type {Map<number, string>} userId -> socketId */
const connectedUsers = new Map();

/** @type {Map<number, Set<number>>} userId -> Set of userIds they're typing to */
const typingUsers = new Map();

/** @type {Map<number, { count: number, resetAt: number }>} userId -> rate limit state */
const socketRateLimits = new Map();

/** @type {Map<number, { typingReset: number }>} userId -> typing rate limit */
const typingRateLimits = new Map();

const SOCKET_RATE_LIMIT = 10; // макс. сообщений
const SOCKET_RATE_WINDOW = 60 * 1000; // 1 минута
const TYPING_RATE_WINDOW = 3000; // мин. 3 сек между typing событиями

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
 * Проверяет rate limit для typing событий
 * @param {number} userId
 * @returns {boolean} — true если лимит превышен
 */
function checkTypingRateLimit(userId) {
  const now = Date.now();
  const state = typingRateLimits.get(userId);

  if (!state || now > state.typingReset) {
    typingRateLimits.set(userId, { typingReset: now + TYPING_RATE_WINDOW });
    return false;
  }

  return true; // ещё не прошло окно
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
  ioInstance = io;
  // Регистрация middleware для аутентификации
  io.use((socket, next) => socketAuth(io, socket, next));

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`🔌 Подключён: ${socket.id} (user: ${userId})`);

    // Автоматически регистрируем пользователя при подключении
    connectedUsers.set(Number(userId), socket.id);
    io.emit('user_status', { userId: Number(userId), status: 'online' });

    socket.on('send_message', (data) => {
      const { receiverId, content, type = 'text', fileUrl = '', fileName = '' } = data;
      const senderId = socket.user.id;
      const receiver = parseInt(receiverId);

      if (!receiver || isNaN(receiver)) return;
      if (receiver == senderId) return;
      if ((!content && !fileUrl)) return;

      // Rate limit проверка
      if (checkSocketRateLimit(senderId)) {
        socket.emit('error', { message: 'Слишком много сообщений, подождите' });
        return;
      }

      // Проверяем что получатель существует
      db.get('SELECT id FROM users WHERE id = ?', [receiver], (err, user) => {
        if (err || !user) {
          socket.emit('error', { message: 'Получатель не найден' });
          return;
        }

        db.run(
        'INSERT INTO messages (sender_id, receiver_id, content, type, file_url) VALUES (?, ?, ?, ?, ?)',
        [senderId, receiver, encrypt(content || ''), type, encrypt(fileUrl || '')],
        function (err) {
          if (err) {
            console.error('❌ Ошибка сохранения сообщения:', err.message);
            return;
          }
          const msg = {
            id: this.lastID,
            sender_id: senderId,
            receiver_id: receiver,
            content,
            type,
            file_url: fileUrl,
            file_name: fileName,
            is_read: 0,
            created_at: new Date().toISOString()
          };

          const receiverSocketId = connectedUsers.get(Number(receiver));
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('new_message', msg);
            // Уведомление — получаем имя отправителя
            db.get('SELECT username, display_name FROM users WHERE id = ?', [senderId], (err, sender) => {
              sendNotification(Number(receiver), 'new_message', {
                fromUserId: senderId,
                fromUsername: sender ? (sender.display_name || sender.username) : '',
                content: content?.substring(0, 100) || (fileName ? '📎 ' + fileName : 'Файл'),
                type
              });
            });
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

    // Статус «печатает...»
    socket.on('typing', ({ toUserId }) => {
      const target = parseInt(toUserId);
      if (!target || isNaN(target) || target == userId) return;
      if (checkTypingRateLimit(Number(userId))) return; // спам-защита
      const targetSocket = connectedUsers.get(target);
      if (targetSocket) {
        io.to(targetSocket).emit('user_typing', { fromUserId: Number(userId) });
      }
    });

    socket.on('stop_typing', ({ toUserId }) => {
      const target = parseInt(toUserId);
      if (!target || isNaN(target) || target == userId) return;
      if (checkTypingRateLimit(Number(userId))) return; // спам-защита
      const targetSocket = connectedUsers.get(target);
      if (targetSocket) {
        io.to(targetSocket).emit('user_stop_typing', { fromUserId: Number(userId) });
      }
    });

    // Переписка удалена — уведомить собеседника
    socket.on('chat_deleted', ({ userId: targetUserId }) => {
      const target = parseInt(targetUserId);
      if (!target || isNaN(target) || target == userId) return;
      const targetSocket = connectedUsers.get(target);
      if (targetSocket) {
        io.to(targetSocket).emit('chat_deleted', { userId: Number(userId) });
      }
    });
  });

  return connectedUsers;
}

/**
 * Отправляет уведомление пользователю (вызывается из роутов)
 * @param {import('socket.io').Server} io
 * @param {number} userId — кому
 * @param {string} type — тип уведомления
 * @param {Object} data — данные
 */
function sendNotification(userId, type, data) {
  if (!ioInstance) return;
  const socketId = connectedUsers.get(Number(userId));
  if (socketId) {
    ioInstance.to(socketId).emit('notification', { type, ...data });
  }
}

module.exports = { setupSocket, connectedUsers, typingUsers, sendNotification };
