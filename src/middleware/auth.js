/**
 * Аутентификация — JWT middleware с blacklist для logout
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('❌ ОШИБКА: JWT_SECRET не установлен в .env');
  process.exit(1);
}

if (JWT_SECRET.length < 32) {
  console.error('⚠️ ПРЕДУПРЕЖДЕНИЕ: JWT_SECRET слишком короткий (минимум 32 символа)');
}

// Blacklist токенов (in-memory, для production лучше Redis)
const tokenBlacklist = new Set();

// Очистка blacklist каждые 24 часа
setInterval(() => {
  if (tokenBlacklist.size > 1000) {
    console.log(`[auth] Blacklist size: ${tokenBlacklist.size}, очищаем...`);
    tokenBlacklist.clear();
  }
}, 24 * 60 * 60 * 1000);

/**
 * Добавляет токен в blacklist
 * @param {string} jti - JWT ID
 */
function blacklistToken(jti) {
  if (jti) {
    tokenBlacklist.add(jti);
    console.log(`[auth] Токен ${jti.slice(0, 8)}... добавлен в blacklist`);
  }
}

/**
 * Проверяет JWT токен из cookie или заголовка Authorization
 */
function authenticateToken(req, res, next) {
  // КРИТИЧНО: запрещаем кэширование авторизованных ответов
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Пробуем cookie (httpOnly — основной метод)
  let token = req.cookies?.token;

  // Fallback: заголовок Authorization
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Неверный токен' });
    }

    // Проверяем blacklist
    if (user.jti && tokenBlacklist.has(user.jti)) {
      return res.status(401).json({ error: 'Токен отозван' });
    }

    // Мягкая проверка device fingerprint
    if (user.device) {
      const crypto = require('crypto');
      const ua = req.headers['user-agent'] || '';
      const currentFp = crypto.createHash('md5').update(ua.slice(0, 128)).digest('hex').slice(0, 16);
      if (user.device !== currentFp) {
        console.warn(`[SECURITY] Device mismatch: User ${user.id} | expected ${user.device.slice(0,8)}... got ${currentFp.slice(0,8)}...`);
      }
    }

    req.user = user;
    next();
  });
}

/**
 * Простая CSRF защита через проверку Origin/Referer
 * Для state-changing операций (POST, PUT, DELETE)
 */
function csrfProtection(req, res, next) {
  const method = req.method;
  
  // Проверяем только state-changing методы
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    return next();
  }

  const origin = req.headers.origin || req.headers.referer;
  const host = req.headers.host;
  
  // Разрешаем запросы с того же origin
  if (origin && host) {
    const originUrl = new URL(origin.startsWith('http') ? origin : `https://${origin}`);
    if (originUrl.host !== host) {
      console.warn(`[CSRF] Blocked request from ${origin} to ${host}`);
      return res.status(403).json({ error: 'CSRF защита: запрос отклонён' });
    }
  }
  
  next();
}

module.exports = { authenticateToken, JWT_SECRET, blacklistToken, csrfProtection };
