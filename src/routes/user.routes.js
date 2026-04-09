/**
 * Маршруты пользователей
 * GET  /api/profile
 * PUT  /api/profile
 * PUT  /api/profile/avatar
 * PUT  /api/profile/password
 * DELETE /api/profile
 * GET  /api/users
 * GET  /api/users/:id
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const db = require('../../config/database');
const { upload, validateImageMagic } = require('../middleware/upload');
const { authenticateToken } = require('../middleware/auth');
const { connectedUsers } = require('../socket/socket');
const { dbGet, dbRun, dbAll } = require('../utils/db');

const AVATARS_DIR = path.join(__dirname, '..', '..', 'public', 'avatars');

/**
 * GET /api/profile
 * Получить свой профиль
 */
router.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT id, username, display_name, avatar, status, bio, e2e_public_key, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    user.status = connectedUsers.has(Number(req.user.id)) ? 'online' : 'offline';
    res.json(user);
  } catch (err) {
    console.error('[user:profile] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * PUT /api/profile
 * Обновить профиль
 */
router.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { display_name, bio, e2e_public_key } = req.body;

    await dbRun(
      'UPDATE users SET display_name = ?, bio = ?, e2e_public_key = COALESCE(?, e2e_public_key) WHERE id = ?',
      [display_name || '', bio || '', e2e_public_key || null, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[user:update] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/**
 * PUT /api/profile/avatar
 * Загрузить аватар
 */
router.put('/api/profile/avatar', authenticateToken, upload.single('avatar'), validateImageMagic, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const avatarPath = '/avatars/' + req.file.filename;

    // Получаем старый аватар
    const user = await dbGet('SELECT avatar FROM users WHERE id = ?', [req.user.id]);
    
    // Обновляем аватар
    await dbRun('UPDATE users SET avatar = ? WHERE id = ?', [avatarPath, req.user.id]);

    // Удаляем старый файл аватара
    if (user?.avatar) {
      const oldPath = path.join(__dirname, '..', '..', 'public', user.avatar);
      if (oldPath.startsWith(AVATARS_DIR)) {
        fsPromises.unlink(oldPath).catch(() => {}); // Игнорируем ошибки удаления
      }
    }

    res.json({ success: true, avatar: avatarPath });
  } catch (err) {
    console.error('[user:avatar] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/**
 * PUT /api/profile/password
 * Смена пароля
 */
router.put('/api/profile/password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    }

    const user = await dbGet('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('[user:password] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * DELETE /api/profile
 * Удалить аккаунт
 */
router.delete('/api/profile', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // Получаем аватар для удаления файла
    const user = await dbGet('SELECT avatar FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Транзакция — удаляем все данные атомарно
    await dbRun('BEGIN TRANSACTION');

    try {
      await dbRun('DELETE FROM post_likes WHERE post_id IN (SELECT id FROM wall_posts WHERE author_id = ? OR user_id = ?)', [userId, userId]);
      await dbRun('DELETE FROM post_comments WHERE user_id = ? OR post_id IN (SELECT id FROM wall_posts WHERE user_id = ?)', [userId, userId]);
      await dbRun('DELETE FROM wall_posts WHERE author_id = ? OR user_id = ?', [userId, userId]);
      await dbRun('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?', [userId, userId]);
      await dbRun('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?', [userId, userId]);
      await dbRun('DELETE FROM users WHERE id = ?', [userId]);

      await dbRun('COMMIT');

      // Удаляем файл аватара
      if (user.avatar) {
        const avatarPath = path.join(__dirname, '..', '..', 'public', user.avatar);
        if (avatarPath.startsWith(AVATARS_DIR)) {
          fsPromises.unlink(avatarPath).catch(() => {});
        }
      }

      // Отключаем сокет
      connectedUsers.delete(Number(userId));
      res.json({ success: true });
    } catch (err) {
      await dbRun('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('[user:delete] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

/**
 * GET /api/users
 * Получить всех пользователей (с пагинацией)
 */
router.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const offset = parseInt(req.query.offset) || 0;

    const users = await dbAll(
      'SELECT id, username, display_name, avatar, status, e2e_public_key FROM users WHERE id != ? ORDER BY username ASC LIMIT ? OFFSET ?',
      [req.user.id, limit, offset]
    );

    users.forEach(u => {
      u.status = connectedUsers.has(Number(u.id)) ? 'online' : 'offline';
    });

    res.json(users);
  } catch (err) {
    console.error('[user:all] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/users/:id
 * Получить профиль другого пользователя
 */
router.get('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Некорректный ID' });
    }
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Используйте /api/profile' });
    }

    const user = await dbGet(
      'SELECT id, username, display_name, avatar, status, bio, e2e_public_key FROM users WHERE id = ?',
      [targetId]
    );

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    user.status = connectedUsers.has(user.id) ? 'online' : 'offline';
    res.json(user);
  } catch (err) {
    console.error('[user:get] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
