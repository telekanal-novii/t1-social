/**
 * Маршруты стены
 * GET    /api/wall/feed
 * GET    /api/wall/:userId
 * POST   /api/wall/:userId
 * POST   /api/wall/like/:postId
 * DELETE /api/wall/like/:postId
 * DELETE /api/wall/:postId
 * PUT    /api/wall/:postId
 * GET    /api/wall/post/:postId/comments
 * POST   /api/wall/post/:postId/comments
 * DELETE /api/wall/comment/:commentId
 * PUT    /api/wall/comment/:commentId
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { authenticateToken } = require('../middleware/auth');
const { postUpload: upload, validatePostImage: validateImageMagic } = require('../middleware/upload');
const { connectedUsers, broadcastNewPost } = require('../socket/socket');
const { dbAll, dbGet, dbRun } = require('../utils/db');

/**
 * GET /api/wall/feed
 * Лента постов с фильтрацией и сортировкой
 */
router.get('/api/wall/feed', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const filter = req.query.filter || 'all';
    const sort = req.query.sort || 'new';

    // Строим WHERE условие
    let whereClause = '';
    const params = [];

    if (filter === 'friends') {
      whereClause = 'WHERE wp.user_id IN (SELECT friend_id FROM friendships WHERE user_id = ? AND status = \'accepted\')';
      params.push(req.user.id);
    }

    const orderBy = sort === 'popular' ? 'wp.likes DESC, wp.created_at DESC' : 'wp.created_at DESC';

    // Загружаем посты
    const posts = await dbAll(
      `SELECT wp.id, wp.user_id, wp.author_id, wp.content, wp.image_url, wp.likes, wp.created_at,
              u.username, u.display_name, u.avatar,
              ow.username as wall_owner_username, ow.display_name as wall_owner_name
       FROM wall_posts wp 
       INNER JOIN users u ON wp.author_id = u.id
       INNER JOIN users ow ON wp.user_id = ow.id
       ${whereClause}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (!posts.length) {
      return res.json({ posts: [], hasMore: false });
    }

    const postIds = posts.map(p => p.id);
    const placeholders = postIds.map(() => '?').join(',');

    // Загружаем лайки и комментарии параллельно
    const [likes, commentCounts] = await Promise.all([
      dbAll(
        `SELECT post_id FROM post_likes WHERE post_id IN (${placeholders}) AND user_id = ?`,
        [...postIds, req.user.id]
      ),
      dbAll(
        `SELECT post_id, COUNT(*) as cnt FROM post_comments WHERE post_id IN (${placeholders}) GROUP BY post_id`,
        postIds
      )
    ]);

    const likedSet = new Set(likes.map(l => l.post_id));
    const countMap = {};
    commentCounts.forEach(c => { countMap[c.post_id] = c.cnt; });

    const result = posts.map(p => ({
      ...p,
      liked: likedSet.has(p.id),
      comment_count: countMap[p.id] || 0
    }));

    // Считаем общее количество постов
    let countQuery, countParams;
    if (filter === 'friends') {
      countQuery = 'SELECT COUNT(*) as count FROM wall_posts WHERE user_id IN (SELECT friend_id FROM friendships WHERE user_id = ? AND status = \'accepted\')';
      countParams = [req.user.id];
    } else {
      countQuery = 'SELECT COUNT(*) as count FROM wall_posts';
      countParams = [];
    }

    const { count } = await dbGet(countQuery, countParams);
    res.json({ posts: result, hasMore: offset + limit < count });
  } catch (err) {
    console.error('[wall:feed] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/wall/:userId
 * Посты стены пользователя
 */
router.get('/api/wall/:userId', authenticateToken, async (req, res) => {
  try {
    const wallOwnerId = parseInt(req.params.userId);
    if (isNaN(wallOwnerId)) {
      return res.status(400).json({ error: 'Некорректный ID' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const posts = await dbAll(
      `SELECT wp.id, wp.user_id, wp.author_id, wp.content, wp.image_url, wp.likes, wp.created_at,
              u.username, u.display_name, u.avatar,
              ow.username as wall_owner_username, ow.display_name as wall_owner_name
       FROM wall_posts wp 
       INNER JOIN users u ON wp.author_id = u.id
       INNER JOIN users ow ON wp.user_id = ow.id
       WHERE wp.user_id = ? ORDER BY wp.created_at DESC LIMIT ? OFFSET ?`,
      [wallOwnerId, limit, offset]
    );

    if (!posts.length) {
      return res.json({ posts: [], hasMore: false });
    }

    const postIds = posts.map(p => p.id);
    const placeholders = postIds.map(() => '?').join(',');

    const [likes, commentCounts] = await Promise.all([
      dbAll(
        `SELECT post_id FROM post_likes WHERE post_id IN (${placeholders}) AND user_id = ?`,
        [...postIds, req.user.id]
      ),
      dbAll(
        `SELECT post_id, COUNT(*) as cnt FROM post_comments WHERE post_id IN (${placeholders}) GROUP BY post_id`,
        postIds
      )
    ]);

    const likedSet = new Set(likes.map(l => l.post_id));
    const countMap = {};
    commentCounts.forEach(c => { countMap[c.post_id] = c.cnt; });

    const result = posts.map(p => ({
      ...p,
      liked: likedSet.has(p.id),
      comment_count: countMap[p.id] || 0
    }));

    const { count } = await dbGet('SELECT COUNT(*) as count FROM wall_posts WHERE user_id = ?', [wallOwnerId]);
    res.json({ posts: result, hasMore: offset + limit < count });
  } catch (err) {
    console.error('[wall:get] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/wall/:userId
 * Создать пост
 */
router.post('/api/wall/:userId', authenticateToken, upload.single('image'), validateImageMagic, async (req, res) => {
  try {
    const wallOwnerId = parseInt(req.params.userId);
    if (isNaN(wallOwnerId)) {
      return res.status(400).json({ error: 'Некорректный ID пользователя' });
    }

    const { content } = req.body;
    if (!content?.trim() && !req.file) {
      return res.status(400).json({ error: 'Добавьте текст или изображение' });
    }
    if (content && content.length > 500) {
      return res.status(400).json({ error: 'Максимум 500 символов' });
    }

    // Проверяем что владелец стены существует
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [wallOwnerId]);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const imageUrl = req.file ? `/media/${req.file.filename}` : '';

    const { lastID } = await dbRun(
      'INSERT INTO wall_posts (user_id, author_id, content, image_url) VALUES (?, ?, ?, ?)',
      [wallOwnerId, req.user.id, (content || '').trim(), imageUrl]
    );

    // Отправляем новый пост всем подключённым клиентам
    const post = await dbGet(
      `SELECT wp.id, wp.user_id, wp.author_id, wp.content, wp.image_url, wp.likes, wp.created_at,
              u.username, u.display_name, u.avatar,
              ow.username as wall_owner_username, ow.display_name as wall_owner_name
       FROM wall_posts wp 
       INNER JOIN users u ON wp.author_id = u.id
       INNER JOIN users ow ON wp.user_id = ow.id
       WHERE wp.id = ?`,
      [lastID]
    );

    if (post) {
      post.liked = false;
      post.comment_count = 0;
      broadcastNewPost(post, req.user.id);
    }

    res.json({ success: true, postId: lastID, image_url: imageUrl });
  } catch (err) {
    console.error('[wall:post] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка создания поста' });
  }
});

/**
 * POST /api/wall/like/:postId
 * Лайкнуть пост
 */
router.post('/api/wall/like/:postId', authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Некорректный ID поста' });
    }

    const post = await dbGet('SELECT id FROM wall_posts WHERE id = ?', [postId]);
    if (!post) {
      return res.status(404).json({ error: 'Пост не найден' });
    }

    try {
      await dbRun('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, req.user.id]);
      await dbRun('UPDATE wall_posts SET likes = likes + 1 WHERE id = ?', [postId]);
      res.json({ success: true });
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Вы уже лайкнули этот пост' });
      }
      throw err;
    }
  } catch (err) {
    console.error('[wall:like] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/**
 * DELETE /api/wall/like/:postId
 * Убрать лайк
 */
router.delete('/api/wall/like/:postId', authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Некорректный ID поста' });
    }

    const { changes } = await dbRun(
      'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
      [postId, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Лайк не найден' });
    }

    await dbRun('UPDATE wall_posts SET likes = MAX(likes - 1, 0) WHERE id = ?', [postId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[wall:unlike] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/**
 * DELETE /api/wall/:postId
 * Удалить пост
 */
router.delete('/api/wall/:postId', authenticateToken, async (req, res) => {
  try {
    const { changes } = await dbRun(
      'DELETE FROM wall_posts WHERE id = ? AND (author_id = ? OR user_id = ?)',
      [req.params.postId, req.user.id, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Пост не найден' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[wall:delete] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

/**
 * PUT /api/wall/:postId
 * Редактировать пост
 */
router.put('/api/wall/:postId', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: 'Содержание обязательно' });
    }
    if (content.length > 500) {
      return res.status(400).json({ error: 'Максимум 500 символов' });
    }

    const { changes } = await dbRun(
      'UPDATE wall_posts SET content = ? WHERE id = ? AND author_id = ?',
      [content.trim(), req.params.postId, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Пост не найден или нет прав' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[wall:edit] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

/**
 * GET /api/wall/post/:postId/comments
 * Комментарии к посту
 */
router.get('/api/wall/post/:postId/comments', authenticateToken, async (req, res) => {
  try {
    const comments = await dbAll(
      `SELECT pc.id, pc.post_id, pc.user_id, pc.content, pc.created_at,
              u.username, u.display_name, u.avatar
       FROM post_comments pc INNER JOIN users u ON pc.user_id = u.id
       WHERE pc.post_id = ? ORDER BY pc.created_at ASC`,
      [req.params.postId]
    );
    res.json(comments);
  } catch (err) {
    console.error('[wall:comments] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/wall/post/:postId/comments
 * Добавить комментарий
 */
router.post('/api/wall/post/:postId/comments', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: 'Комментарий не может быть пустым' });
    }
    if (content.length > 300) {
      return res.status(400).json({ error: 'Максимум 300 символов' });
    }

    const { lastID } = await dbRun(
      'INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)',
      [req.params.postId, req.user.id, content.trim()]
    );

    res.json({ success: true, commentId: lastID });
  } catch (err) {
    console.error('[wall:comment] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка создания комментария' });
  }
});

/**
 * DELETE /api/wall/comment/:commentId
 * Удалить комментарий
 */
router.delete('/api/wall/comment/:commentId', authenticateToken, async (req, res) => {
  try {
    const { changes } = await dbRun(
      'DELETE FROM post_comments WHERE id = ? AND user_id = ?',
      [req.params.commentId, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Комментарий не найден' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[wall:comment:delete] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

/**
 * PUT /api/wall/comment/:commentId
 * Редактировать комментарий
 */
router.put('/api/wall/comment/:commentId', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: 'Комментарий не может быть пустым' });
    }
    if (content.length > 300) {
      return res.status(400).json({ error: 'Максимум 300 символов' });
    }

    const { changes } = await dbRun(
      'UPDATE post_comments SET content = ? WHERE id = ? AND user_id = ?',
      [content.trim(), req.params.commentId, req.user.id]
    );

    if (changes === 0) {
      return res.status(404).json({ error: 'Комментарий не найден или нет прав' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[wall:comment:edit] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

module.exports = router;
