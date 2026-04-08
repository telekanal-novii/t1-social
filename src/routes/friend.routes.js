/**
 * Маршруты дружбы
 * GET    /api/friends
 * GET    /api/friends/requests
 * GET    /api/friends/statuses
 * POST   /api/friends/request
 * PUT    /api/friends/accept/:id
 * DELETE /api/friends/reject/:id
 * DELETE /api/friends/:id
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { authenticateToken } = require('../middleware/auth');

/** Список друзей */
router.get('/api/friends', authenticateToken, (req, res) => {
  db.all(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.status
     FROM users u INNER JOIN friendships f ON u.id = f.friend_id
     WHERE f.user_id = ? AND f.status = 'accepted'
     UNION
     SELECT u.id, u.username, u.display_name, u.avatar, u.status
     FROM users u INNER JOIN friendships f ON u.id = f.user_id
     WHERE f.friend_id = ? AND f.status = 'accepted'`,
    [req.user.id, req.user.id],
    (err, friends) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(friends);
    });
});

/** Заявки в друзья */
router.get('/api/friends/requests', authenticateToken, (req, res) => {
  db.all(
    `SELECT f.id as friendship_id, u.id as user_id, u.username, u.display_name, u.avatar, u.status, f.created_at
     FROM users u INNER JOIN friendships f ON u.id = f.user_id
     WHERE f.friend_id = ? AND f.status = 'pending'`,
    [req.user.id],
    (err, requests) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(requests);
    });
});

/** Статусы дружбы */
router.get('/api/friends/statuses', authenticateToken, (req, res) => {
  db.all('SELECT user_id, friend_id, status FROM friendships WHERE user_id = ? OR friend_id = ?',
    [req.user.id, req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      const statuses = {};
      rows.forEach(row => {
        const other = row.user_id === req.user.id ? row.friend_id : row.user_id;
        statuses[other] = { status: row.status, direction: row.user_id === req.user.id ? 'sent' : 'received' };
      });
      res.json(statuses);
    });
});

/** Отправить заявку */
router.post('/api/friends/request', authenticateToken, (req, res) => {
  const friendId = parseInt(req.body.friendId);
  if (!friendId || isNaN(friendId)) return res.status(400).json({ error: 'ID друга обязателен' });
  if (friendId === req.user.id) return res.status(400).json({ error: 'Нельзя добавить себя' });

  // Проверяем что друг существует
  db.get('SELECT id FROM users WHERE id = ?', [friendId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    db.run('INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)',
      [req.user.id, friendId, 'pending'], function (err) {
        if (err) {
          return err.message.includes('UNIQUE')
            ? res.status(400).json({ error: 'Заявка уже отправлена' })
            : res.status(500).json({ error: 'Ошибка отправки заявки' });
        }
        res.json({ success: true, friendshipId: this.lastID });
      });
  });
});

/** Принять заявку */
router.put('/api/friends/accept/:id', authenticateToken, (req, res) => {
  db.get('SELECT user_id, friend_id FROM friendships WHERE id = ?', [req.params.id], (err, f) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!f) return res.status(404).json({ error: 'Заявка не найдена' });
    if (f.friend_id !== req.user.id) return res.status(403).json({ error: 'Это не ваша заявка' });

    const friendId = f.user_id;
    db.run("UPDATE friendships SET status = 'accepted' WHERE id = ?", [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      // Удаляем встречную заявку
      db.run("DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
        [req.user.id, friendId], () => res.json({ success: true }));
    });
  });
});

/** Отклонить заявку */
router.delete('/api/friends/reject/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM friendships WHERE id = ? AND friend_id = ?',
    [req.params.id, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Заявка не найдена' });
      res.json({ success: true });
    });
});

/** Удалить друга */
router.delete('/api/friends/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
    [req.user.id, req.params.id, req.params.id, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Друг не найден' });
      res.json({ success: true });
    });
});

module.exports = router;
