/**
 * Маршруты стены
 * GET    /api/wall/feed
 * GET    /api/wall/:userId
 * POST   /api/wall/:userId
 * POST   /api/wall/like/:postId
 * DELETE /api/wall/like/:postId
 * DELETE /api/wall/:postId
 * GET    /api/wall/post/:postId/comments
 * POST   /api/wall/post/:postId/comments
 * DELETE /api/wall/comment/:commentId
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { authenticateToken } = require('../middleware/auth');
const { upload, validateImageMagic } = require('../middleware/upload-post');
const { connectedUsers, broadcastNewPost } = require('../socket/socket');

/** Получить ленту постов с фильтрацией и сортировкой
 *  Query: filter=all|friends|mine, sort=new|popular
 */
router.get('/api/wall/feed', authenticateToken, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const filter = req.query.filter || 'all'; // all | friends | mine
  const sort = req.query.sort || 'new';     // new | popular

  // Строим WHERE условие
  let whereClause = '';
  const params = [];

  if (filter === 'friends') {
    whereClause = 'WHERE wp.user_id IN (SELECT friend_id FROM friendships WHERE user_id = ? AND status = \'accepted\')';
    params.push(req.user.id);
  } else if (filter === 'mine') {
    whereClause = 'WHERE wp.author_id = ?';
    params.push(req.user.id);
  }

  // Сортировка
  const orderBy = sort === 'popular' ? 'wp.likes DESC, wp.created_at DESC' : 'wp.created_at DESC';

  db.all(
    `SELECT wp.id, wp.user_id, wp.author_id, wp.content, wp.image_url, wp.likes, wp.created_at,
            u.username, u.display_name, u.avatar
     FROM wall_posts wp INNER JOIN users u ON wp.author_id = u.id
     ${whereClause}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, offset], (err, posts) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (!posts.length) return res.json({ posts: [], hasMore: false });

      // Проверяем лайки текущего пользователя и считаем комментарии
      const postIds = posts.map(p => p.id);
      const placeholders = postIds.map(() => '?').join(',');

      db.all(
        `SELECT post_id FROM post_likes WHERE post_id IN (${placeholders}) AND user_id = ?`,
        [...postIds, req.user.id], (err, liked) => {
          if (err) return res.status(500).json({ error: 'Ошибка сервера' });
          const likedSet = new Set(liked.map(l => l.post_id));

          // Считаем комментарии для каждого поста
          db.all(
            `SELECT post_id, COUNT(*) as cnt FROM post_comments WHERE post_id IN (${placeholders}) GROUP BY post_id`,
            [...postIds], (err, commentCounts) => {
              const countMap = {};
              if (commentCounts) commentCounts.forEach(c => { countMap[c.post_id] = c.cnt; });

              const result = posts.map(p => ({
                ...p,
                liked: likedSet.has(p.id),
                comment_count: countMap[p.id] || 0
              }));

              // Считаем общее количество постов с учётом фильтра
              let countQuery, countParams;
              if (filter === 'friends') {
                countQuery = 'SELECT COUNT(*) as count FROM wall_posts WHERE user_id IN (SELECT friend_id FROM friendships WHERE user_id = ? AND status = \'accepted\')';
                countParams = [req.user.id];
              } else if (filter === 'mine') {
                countQuery = 'SELECT COUNT(*) as count FROM wall_posts WHERE author_id = ?';
                countParams = [req.user.id];
              } else {
                countQuery = 'SELECT COUNT(*) as count FROM wall_posts';
                countParams = [];
              }

              db.get(countQuery, countParams, (err, row) => {
                if (err) return res.status(500).json({ error: 'Ошибка сервера' });
                const count = row ? row.count : 0;
                res.json({ posts: result, hasMore: offset + limit < count });
              });
            }
          );
        }
      );
    });
});

/** Получить посты стены */
router.get('/api/wall/:userId', authenticateToken, (req, res) => {
  const wallOwnerId = parseInt(req.params.userId);
  if (isNaN(wallOwnerId)) return res.status(400).json({ error: 'Некорректный ID' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  db.all(
    `SELECT wp.id, wp.user_id, wp.author_id, wp.content, wp.image_url, wp.likes, wp.created_at,
            u.username, u.display_name, u.avatar
     FROM wall_posts wp INNER JOIN users u ON wp.author_id = u.id
     WHERE wp.user_id = ? ORDER BY wp.created_at DESC LIMIT ? OFFSET ?`,
    [wallOwnerId, limit, offset], (err, posts) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });

      // Для каждого поста проверяем, лайкнул ли текущий пользователь
      const postIds = posts.map(p => p.id);
      if (postIds.length === 0) return res.json({ posts: [], hasMore: false });

      const placeholders = postIds.map(() => '?').join(',');

      db.all(
        `SELECT post_id FROM post_likes WHERE post_id IN (${placeholders}) AND user_id = ?`,
        [...postIds, req.user.id], (err, liked) => {
          if (err) return res.status(500).json({ error: 'Ошибка сервера' });
          const likedSet = new Set(liked.map(l => l.post_id));

          // Считаем комментарии
          db.all(
            `SELECT post_id, COUNT(*) as cnt FROM post_comments WHERE post_id IN (${placeholders}) GROUP BY post_id`,
            [...postIds], (err, commentCounts) => {
              const countMap = {};
              if (commentCounts) commentCounts.forEach(c => { countMap[c.post_id] = c.cnt; });

              const result = posts.map(p => ({
                ...p,
                liked: likedSet.has(p.id),
                comment_count: countMap[p.id] || 0
              }));

              // Проверяем есть ли ещё посты
              db.get('SELECT COUNT(*) as count FROM wall_posts WHERE user_id = ?', [wallOwnerId], (err, { count }) => {
                res.json({ posts: result, hasMore: offset + limit < count });
              });
            }
          );
        }
      );
    });
});

/** Создать пост */
router.post('/api/wall/:userId', authenticateToken, upload.single('image'), validateImageMagic, async (req, res) => {
  const wallOwnerId = parseInt(req.params.userId);
  if (isNaN(wallOwnerId)) return res.status(400).json({ error: 'Некорректный ID пользователя' });

  const { content } = req.body;
  if (!content?.trim() && !req.file) return res.status(400).json({ error: 'Добавьте текст или изображение' });
  if (content && content.length > 500) return res.status(400).json({ error: 'Максимум 500 символов' });

  // Проверяем что владелец стены существует
  db.get('SELECT id FROM users WHERE id = ?', [wallOwnerId], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const imageUrl = req.file ? `/media/${req.file.filename}` : '';

    db.run('INSERT INTO wall_posts (user_id, author_id, content, image_url) VALUES (?, ?, ?, ?)',
      [wallOwnerId, req.user.id, (content || '').trim(), imageUrl], function (err) {
        if (err) return res.status(500).json({ error: 'Ошибка создания поста' });

        // Отправляем новый пост всем подключённым клиентам через socket
        db.get(
          `SELECT wp.id, wp.user_id, wp.author_id, wp.content, wp.image_url, wp.likes, wp.created_at,
                  u.username, u.display_name, u.avatar
           FROM wall_posts wp INNER JOIN users u ON wp.author_id = u.id
           WHERE wp.id = ?`,
          [this.lastID],
          (err, post) => {
            if (!err && post) {
              post.liked = false;
              post.comment_count = 0;
              broadcastNewPost(post, req.user.id);
            }
          }
        );

        res.json({ success: true, postId: this.lastID, image_url: imageUrl });
      });
  });
});

/** Лайкнуть пост */
router.post('/api/wall/like/:postId', authenticateToken, (req, res) => {
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) return res.status(400).json({ error: 'Некорректный ID поста' });

  // Проверяем что пост существует
  db.get('SELECT id FROM wall_posts WHERE id = ?', [postId], (err, post) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    // Пытаемся добавить лайк (UNIQUE защитит от повторных)
    db.run('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, req.user.id], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Вы уже лайкнули этот пост' });
        }
        return res.status(500).json({ error: 'Ошибка обновления' });
      }
      // Обновляем счётчик
      db.run('UPDATE wall_posts SET likes = likes + 1 WHERE id = ?', [postId]);
      res.json({ success: true });
    });
  });
});

/** Убрать лайк */
router.delete('/api/wall/like/:postId', authenticateToken, (req, res) => {
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) return res.status(400).json({ error: 'Некорректный ID поста' });

  // Удаляем лайк
  db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: 'Ошибка обновления' });
    if (this.changes === 0) return res.status(404).json({ error: 'Лайк не найден' });
    // Обновляем счётчик
    db.run('UPDATE wall_posts SET likes = MAX(likes - 1, 0) WHERE id = ?', [postId]);
    res.json({ success: true });
  });
});

/** Удалить пост */
router.delete('/api/wall/:postId', authenticateToken, (req, res) => {
  db.run('DELETE FROM wall_posts WHERE id = ? AND (author_id = ? OR user_id = ?)',
    [req.params.postId, req.user.id, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Пост не найден' });
      res.json({ success: true });
    });
});

/** Комментарии к посту */
router.get('/api/wall/post/:postId/comments', authenticateToken, (req, res) => {
  db.all(
    `SELECT pc.id, pc.post_id, pc.user_id, pc.content, pc.created_at,
            u.username, u.display_name, u.avatar
     FROM post_comments pc INNER JOIN users u ON pc.user_id = u.id
     WHERE pc.post_id = ? ORDER BY pc.created_at ASC`,
    [req.params.postId], (err, comments) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(comments);
    });
});

/** Добавить комментарий */
router.post('/api/wall/post/:postId/comments', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Комментарий не может быть пустым' });
  if (content.length > 300) return res.status(400).json({ error: 'Максимум 300 символов' });

  db.run('INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)',
    [req.params.postId, req.user.id, content.trim()], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка создания комментария' });
      res.json({ success: true, commentId: this.lastID });
    });
});

/** Удалить комментарий */
router.delete('/api/wall/comment/:commentId', authenticateToken, (req, res) => {
  db.run('DELETE FROM post_comments WHERE id = ? AND user_id = ?',
    [req.params.commentId, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Комментарий не найден' });
      res.json({ success: true });
    });
});

/** Редактировать пост (только автор) */
router.put('/api/wall/:postId', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Содержание обязательно' });
  if (content.length > 500) return res.status(400).json({ error: 'Максимум 500 символов' });

  db.run('UPDATE wall_posts SET content = ? WHERE id = ? AND author_id = ?',
    [content.trim(), req.params.postId, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Пост не найден или нет прав' });
      res.json({ success: true });
    });
});

/** Редактировать комментарий (только автор) */
router.put('/api/wall/comment/:commentId', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Комментарий не может быть пустым' });
  if (content.length > 300) return res.status(400).json({ error: 'Максимум 300 символов' });

  db.run('UPDATE post_comments SET content = ? WHERE id = ? AND user_id = ?',
    [content.trim(), req.params.commentId, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Комментарий не найден или нет прав' });
      res.json({ success: true });
    });
});

module.exports = router;
