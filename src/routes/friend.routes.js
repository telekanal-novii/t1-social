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
const { authenticateToken } = require('../middleware/auth');
const { sendNotification } = require('../socket/socket');
const { dbAll, dbGet, dbRun, checkUserExists } = require('../utils/db');

/**
 * GET /api/friends
 * Список друзей
 */
router.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    const friends = await dbAll(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.status
       FROM users u INNER JOIN friendships f ON u.id = f.friend_id
       WHERE f.user_id = ? AND f.status = 'accepted'
       UNION
       SELECT u.id, u.username, u.display_name, u.avatar, u.status
       FROM users u INNER JOIN friendships f ON u.id = f.user_id
       WHERE f.friend_id = ? AND f.status = 'accepted'`,
      [req.user.id, req.user.id]
    );
    res.json(friends);
  } catch (err) {
    console.error('[friend:list] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/friends/requests
 * Заявки в друзья
 */
router.get('/api/friends/requests', authenticateToken, async (req, res) => {
  try {
    const requests = await dbAll(
      `SELECT f.id as friendship_id, u.id as user_id, u.username, u.display_name, u.avatar, u.status, f.created_at
       FROM users u INNER JOIN friendships f ON u.id = f.user_id
       WHERE f.friend_id = ? AND f.status = 'pending'`,
      [req.user.id]
    );
    res.json(requests);
  } catch (err) {
    console.error('[friend:requests] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/friends/statuses
 * Статусы дружбы
 */
router.get('/api/friends/statuses', authenticateToken, async (req, res) => {
  try {
    const rows = await dbAll(
      'SELECT user_id, friend_id, status FROM friendships WHERE user_id = ? OR friend_id = ?',
      [req.user.id, req.user.id]
    );

    const statuses = {};
    rows.forEach(row => {
      const other = row.user_id === req.user.id ? row.friend_id : row.user_id;
      statuses[other] = {
        status: row.status,
        direction: row.user_id === req.user.id ? 'sent' : 'received'
      };
    });

    res.json(statuses);
  } catch (err) {
    console.error('[friend:statuses] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/friends/request
 * Отправить заявку
 */
router.post('/api/friends/request', authenticateToken, async (req, res) => {
  try {
    const friendId = parseInt(req.body.friendId);
    if (!friendId || isNaN(friendId)) {
      return res.status(400).json({ error: 'ID друга обязателен' });
    }
    if (friendId === req.user.id) {
      return res.status(400).json({ error: 'Нельзя добавить себя' });
    }

    // Проверяем что друг существует
    const { exists } = await checkUserExists(friendId);
    if (!exists) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    try {
      const { lastID: friendshipId } = await dbRun(
        'INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)',
        [req.user.id, friendId, 'pending']
      );

      // Уведомление получателю
      sendNotification(friendId, 'friend_request', {
        fromUserId: req.user.id,
        fromUsername: req.user.username
      });

      res.json({ success: true, friendshipId });
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Заявка уже отправлена' });
      }
      throw err;
    }
  } catch (err) {
    console.error('[friend:request] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка отправки заявки' });
  }
});

/**
 * PUT /api/friends/accept/:id
 * Принять заявку
 */
router.put('/api/friends/accept/:id', authenticateToken, async (req, res) => {
  try {
    const f = await dbGet('SELECT user_id, friend_id FROM friendships WHERE id = ?', [req.params.id]);
    
    if (!f) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    if (f.friend_id !== req.user.id) {
      return res.status(403).json({ error: 'Это не ваша заявка' });
    }

    const friendId = f.user_id;

    // Обновляем статус на accepted
    await dbRun("UPDATE friendships SET status = 'accepted' WHERE id = ?", [req.params.id]);
    
    // Удаляем встречную заявку
    await dbRun(
      "DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'pending'",
      [req.user.id, friendId]
    );

    // Уведомление отправителю заявки
    sendNotification(friendId, 'friend_accepted', {
      fromUserId: req.user.id,
      fromUsername: req.user.username
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[friend:accept] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/**
 * DELETE /api/friends/reject/:id
 * Отклонить заявку
 */
router.delete('/api/friends/reject/:id', authenticateToken, async (req, res) => {
  try {
    const { changes } = await dbRun(
      'DELETE FROM friendships WHERE id = ? AND friend_id = ?',
      [req.params.id, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[friend:reject] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

/**
 * DELETE /api/friends/:id
 * Удалить друга
 */
router.delete('/api/friends/:id', authenticateToken, async (req, res) => {
  try {
    const friendId = parseInt(req.params.id);
    if (isNaN(friendId)) {
      return res.status(400).json({ error: 'Некорректный ID' });
    }

    const { changes } = await dbRun(
      'DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.user.id, friendId, friendId, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Друг не найден' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[friend:remove] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
