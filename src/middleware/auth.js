/**
 * Аутентификация — JWT middleware
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

/**
 * Проверяет JWT токен из cookie или заголовка Authorization
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authenticateToken(req, res, next) {
  // КРИТИЧНО: запрещаем кэширование авторизованных ответов
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Пробуем cookie (httpOnly — основной метод)
  let token = req.cookies?.token;

  // Fallback: заголовок Authorization (для обратной совместимости)
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

    // Мягкая проверка device fingerprint — НЕ блокируем, а логируем
    if (user.device) {
      const ua = req.headers['user-agent'] || '';
      const crypto = require('crypto');
      const currentFp = crypto.createHash('md5').update(ua.slice(0, 128)).digest('hex').slice(0, 16);
      if (user.device !== currentFp) {
        // Логируем но НЕ блокируем — device fingerprint для мониторинга, не для блокировки
        console.warn(`[SECURITY] Device mismatch: User ${user.id} | expected ${user.device.slice(0,8)}... got ${currentFp.slice(0,8)}... | UA: ${ua.slice(0, 60)}...`);
      }
    }

    req.user = user;
    next();
  });
}

module.exports = { authenticateToken, JWT_SECRET };
