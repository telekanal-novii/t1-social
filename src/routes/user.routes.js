/**
 * Маршруты пользователей
 * GET  /api/profile
 * PUT  /api/profile
 * PUT  /api/profile/avatar
 * GET  /api/users
 * GET  /api/users/:id
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { upload, validateImageMagic } = require('../middleware/upload');
const { authenticateToken } = require('../middleware/auth');
const { connectedUsers } = require('../socket/socket');
const path = require('path');
const fs = require('fs');

/** Получить свой профиль */
router.get('/api/profile', authenticateToken, (req, res) => {
  db.get('SELECT id, username, display_name, avatar, status, bio, e2e_public_key, created_at FROM users WHERE id = ?',
    [req.user.id], (err, user) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      user.status = connectedUsers.has(req.user.id) ? 'online' : 'offline';
      res.json(user);
    });
});

/** Обновить профиль */
router.put('/api/profile', authenticateToken, (req, res) => {
  const { display_name, bio, e2e_public_key } = req.body;
  db.run('UPDATE users SET display_name = ?, bio = ?, e2e_public_key = COALESCE(?, e2e_public_key) WHERE id = ?',
    [display_name || '', bio || '', e2e_public_key || null, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      res.json({ success: true });
    });
});

/** Загрузить аватар */
router.put('/api/profile/avatar', authenticateToken, upload.single('avatar'), validateImageMagic, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  const avatarPath = '/avatars/' + req.file.filename;

  // Сначала получаем старый аватар
  db.get('SELECT avatar FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });

    // Обновляем аватар
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatarPath, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });

      // Удаляем старый файл аватара если он есть
      if (user && user.avatar) {
        const oldPath = path.join(__dirname, '..', '..', 'public', user.avatar);
        // Проверяем что удаляем только файлы из папки avatars (защита от path traversal)
        if (oldPath.startsWith(path.join(__dirname, '..', '..', 'public', 'avatars'))) {
          fs.unlink(oldPath, () => {}); // игнорируем ошибки удаления
        }
      }

      res.json({ success: true, avatar: avatarPath });
    });
  });
});

/** Получить всех пользователей (со статусом из socket) */
router.get('/api/users', authenticateToken, (req, res) => {
  db.all('SELECT id, username, display_name, avatar, status, e2e_public_key FROM users WHERE id != ? ORDER BY username ASC',
    [req.user.id], (err, users) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      users.forEach(u => {
        u.status = connectedUsers.has(Number(u.id)) ? 'online' : 'offline';
      });
      res.json(users);
    });
});

/** Получить профиль другого пользователя */
router.get('/api/users/:id', authenticateToken, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Некорректный ID' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Используйте /api/profile' });

  db.get('SELECT id, username, display_name, avatar, status, bio, e2e_public_key FROM users WHERE id = ?',
    [targetId], (err, user) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      user.status = connectedUsers.has(user.id) ? 'online' : 'offline';
      res.json(user);
    });
});

module.exports = router;
