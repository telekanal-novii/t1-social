/**
 * Маршруты аутентификации
 * POST /api/register
 * POST /api/login
 * POST /api/logout
 */
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();
const { JWT_SECRET, blacklistToken } = require('../middleware/auth');
const { dbRun, dbGet } = require('../utils/db');

/**
 * Устанавливает httpOnly cookie с токеном
 * КРИТИЧНО: запрещаем кэширование чтобы CDN не сохранял куки
 */
function setTokenCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    path: '/'
  });
}

/**
 * Создаёт отпечаток устройства из User-Agent
 */
function createDeviceFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('md5').update(ua.slice(0, 128)).digest('hex').slice(0, 16);
}

/**
 * POST /api/register
 * Регистрация нового пользователя
 */
router.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    // Валидация username: 2-30 символов, только буквы, цифры, _, -
    const usernameRegex = /^[a-zA-Z0-9_-]{2,30}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: 'Логин: 2-30 символов, только латиница, цифры, _ и -' });
    }

    // Валидация пароля: мин. 8 символов
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    }

    const hashed = await bcrypt.hash(password, 10);

    try {
      const { lastID: userId } = await dbRun(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username.trim(), hashed]
      );

      const deviceFp = createDeviceFingerprint(req);
      const token = jwt.sign({
        id: userId,
        username,
        jti: crypto.randomUUID(),
        iat: Date.now(),
        device: deviceFp
      }, JWT_SECRET, { expiresIn: '7d' });
      
      setTokenCookie(res, token);
      res.status(201).json({ userId, username });
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Логин уже занят' });
      }
      throw err;
    }
  } catch (err) {
    console.error('[auth:register] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/login
 * Авторизация пользователя
 */
router.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    // Получаем пользователя БЕЗ пароля в ответе
    const user = await dbGet(
      'SELECT id, username, password FROM users WHERE username = ?',
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const deviceFp = createDeviceFingerprint(req);
    const token = jwt.sign({
      id: user.id,
      username: user.username,
      jti: crypto.randomUUID(),
      iat: Date.now(),
      device: deviceFp
    }, JWT_SECRET, { expiresIn: '7d' });
    
    setTokenCookie(res, token);
    res.json({ userId: user.id, username: user.username });
  } catch (err) {
    console.error('[auth:login] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/logout
 * Выход — добавляем токен в blacklist и удаляем cookie
 */
router.post('/api/logout', (req, res) => {
  // Добавляем токен в blacklist если он есть
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.jti) {
        blacklistToken(decoded.jti);
      }
    } catch (e) {
      // Игнорируем ошибки — токен мог истечь
    }
  }
  
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});

module.exports = router;
