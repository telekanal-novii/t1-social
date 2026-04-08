/**
 * Маршруты аутентификации
 * POST /api/register
 * POST /api/login
 * POST /api/logout
 */
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../../config/database');
const { JWT_SECRET } = require('../middleware/auth');

/**
 * Устанавливает httpOnly cookie с токеном
 */
function setTokenCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // true только на продакшене (нужен HTTPS)
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    path: '/'
  });
}

/**
 * Регистрация нового пользователя
 * @body {string} username - Логин (2-30 символов, a-z, 0-9, _, -)
 * @body {string} password - Пароль (мин. 8 символов)
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

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username.trim(), hashed], function (err) {
      if (err) {
        return err.message.includes('UNIQUE')
          ? res.status(400).json({ error: 'Логин уже занят' })
          : res.status(500).json({ error: 'Ошибка регистрации' });
      }

      const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '7d' });
      setTokenCookie(res, token);
      res.status(201).json({ userId: this.lastID, username });
    });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * Авторизация пользователя
 * @body {string} username
 * @body {string} password
 */
router.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    try {
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return res.status(401).json({ error: 'Неверный логин или пароль' });

      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      setTokenCookie(res, token);
      res.json({ userId: user.id, username: user.username });
    } catch {
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });
});

/**
 * Выход — удаляем cookie
 */
router.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});

module.exports = router;
