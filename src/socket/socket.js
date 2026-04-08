/**
 * Socket.IO — сообщения и статусы в реальном времени
 */
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { encrypt } = require('../utils/crypto');

/** @type {import('socket.io').Server} */
let ioInstance = null;

/** @type {Map<number, Set<string>>} userId -> Set of socketIds (поддержка нескольких вкладок) */
const connectedUsers = new Map();

/** @type {Map<number, Set<number>>} userId -> Set of userIds they're typing to */
const typingUsers = new Map();

/** @type {Map<number, { count: number, resetAt: number }>} userId -> rate limit state */
const socketRateLimits = new Map();

/** @type {Map<number, { typingReset: number }>} userId -> typing rate limit */
const typingRateLimits = new Map();

const SOCKET_RATE_LIMIT = 10; // макс. сообщений в минуту
const SOCKET_RATE_WINDOW = 60 * 1000;
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

  return true;
}

/**
 * Socket.IO middleware — проверяет JWT токен при подключении
 */
function socketAuth(io, socket, next) {
  let token = socket.handshake.auth.token;

  if (!token) {
    token = socket.handshake.query.token;
  }

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
    socket.user = decoded;
    next();
  });
}

/**
 * Получить количество подключений пользователя
 */
function getConnectionCount(userId) {
  const sockets = connectedUsers.get(Number(userId));
  return sockets ? sockets.size : 0;
}

/**
 * Настраивает обработчики Socket.IO
 */
function setupSocket(io, db) {
  ioInstance = io;
  io.use((socket, next) => socketAuth(io, socket, next));

  io.on('connection', (socket) => {
    const userId = Number(socket.user.id);

    // Добавляем сокет в Set (поддержка нескольких вкладок)
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    // Статус online — только если это первое подключение
    if (getConnectionCount(userId) === 1) {
      db.run("UPDATE users SET status = 'online' WHERE id = ?", [userId]);
      io.emit('user_status', { userId, status: 'online' });
    }

    console.log(`🔌 Подключён: ${socket.id} (user: ${userId}, подключений: ${getConnectionCount(userId)})`);

    // ========== Отправка сообщений ==========
    socket.on('send_message', (data) => {
      const { receiverId, content, type = 'text', fileUrl = '', fileName = '' } = data;
      const receiver = parseInt(receiverId);

      if (!receiver || isNaN(receiver)) return;
      if (receiver === userId) return;
      if (!content && !fileUrl) return;

      if (checkSocketRateLimit(userId)) {
        socket.emit('error', { message: 'Слишком много сообщений, подождите' });
        return;
      }

      db.get('SELECT id FROM users WHERE id = ?', [receiver], (err, user) => {
        if (err || !user) {
          socket.emit('error', { message: 'Получатель не найден' });
          return;
        }

        db.run(
          'INSERT INTO messages (sender_id, receiver_id, content, type, file_url) VALUES (?, ?, ?, ?, ?)',
          [userId, receiver, encrypt(content || ''), type, encrypt(fileUrl || '')],
          function (err) {
            if (err) {
              console.error('❌ Ошибка сохранения сообщения:', err.message);
              return;
            }

            const msg = {
              id: this.lastID,
              sender_id: userId,
              receiver_id: receiver,
              content,
              type,
              file_url: fileUrl,
              file_name: fileName,
              is_read: 0,
              created_at: new Date().toISOString()
            };

            // Отправляем получателю (на ВСЕ его сокеты)
            const receiverSockets = connectedUsers.get(receiver);
            if (receiverSockets) {
              receiverSockets.forEach(sid => {
                io.to(sid).emit('new_message', msg);
              });

              // Уведомление
              db.get('SELECT username, display_name FROM users WHERE id = ?', [userId], (err, sender) => {
                sendNotification(receiver, 'new_message', {
                  fromUserId: userId,
                  fromUsername: sender ? (sender.display_name || sender.username) : '',
                  content: content?.substring(0, 100) || (fileName ? '📎 ' + fileName : 'Файл'),
                  type
                });
              });
            }

            // Подтверждение отправителю
            socket.emit('message_sent', msg);
          }
        );
      });
    });

    // ========== Отключение ==========
    socket.on('disconnect', () => {
      const sockets = connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
      }

      // Статус offline — только если ВСЕ сокеты отключились
      if (!sockets || sockets.size === 0) {
        connectedUsers.delete(userId);
        db.run("UPDATE users SET status = 'offline' WHERE id = ?", [userId]);
        io.emit('user_status', { userId, status: 'offline' });
        console.log(`🔌 Отключён: пользователь ${userId} (последний сокет)`);
      } else {
        console.log(`🔌 Отключён: ${socket.id} (user: ${userId}, осталось: ${sockets.size})`);
      }
    });

    // ========== Печатает... ==========
    socket.on('typing', ({ toUserId }) => {
      const target = parseInt(toUserId);
      if (!target || isNaN(target) || target === userId) return;
      if (checkTypingRateLimit(userId)) return;

      const targetSockets = connectedUsers.get(target);
      if (targetSockets) {
        targetSockets.forEach(sid => {
          io.to(sid).emit('user_typing', { fromUserId: userId });
        });
      }
    });

    socket.on('stop_typing', ({ toUserId }) => {
      const target = parseInt(toUserId);
      if (!target || isNaN(target) || target === userId) return;
      if (checkTypingRateLimit(userId)) return;

      const targetSockets = connectedUsers.get(target);
      if (targetSockets) {
        targetSockets.forEach(sid => {
          io.to(sid).emit('user_stop_typing', { fromUserId: userId });
        });
      }
    });

    // ========== Переписка удалена ==========
    socket.on('chat_deleted', ({ userId: targetUserId }) => {
      const target = parseInt(targetUserId);
      if (!target || isNaN(target) || target === userId) return;

      const targetSockets = connectedUsers.get(target);
      if (targetSockets) {
        targetSockets.forEach(sid => {
          io.to(sid).emit('chat_deleted', { userId });
        });
      }
    });
  });

  return connectedUsers;
}

/**
 * Отправляет уведомление пользователю (вызывается из роутов)
 */
function sendNotification(userId, type, data) {
  if (!ioInstance) return;
  const sockets = connectedUsers.get(Number(userId));
  if (sockets) {
    sockets.forEach(sid => {
      ioInstance.to(sid).emit('notification', { type, ...data });
    });
  }
}

/**
 * Отправляет уведомление о новом посте всем клиентам (кроме автора)
 */
function broadcastNewPost(post, authorId) {
  if (!ioInstance) return;
  connectedUsers.forEach((socketIds, uid) => {
    if (uid !== authorId) {
      socketIds.forEach(sid => {
        ioInstance.to(sid).emit('new_post', post);
      });
    }
  });
}

module.exports = { setupSocket, connectedUsers, typingUsers, sendNotification, getConnectionCount, broadcastNewPost };
