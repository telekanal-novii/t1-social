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
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken, JWT_SECRET };
