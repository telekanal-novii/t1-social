/**
 * Маршруты сообщений
 * POST   /api/messages/upload
 * POST   /api/messages
 * DELETE /api/messages/:userId
 * GET    /api/conversations
 * GET    /api/messages/:userId
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { upload, validateMediaMagic } = require('../middleware/upload-media');
const { authenticateToken } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto');
const path = require('path');

/** Загрузить файл */
router.post('/api/messages/upload', authenticateToken, upload.single('file'), validateMediaMagic, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  let type = 'file';
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(ext)) type = 'image';
  else if (/\.(mp3|wav|ogg)$/.test(ext)) type = 'audio';
  else if (/\.(mp4|webm|mkv|avi)$/.test(ext)) type = 'video';
  res.json({ success: true, fileUrl: '/media/' + req.file.filename, type, fileName: req.file.originalname });
});

/** Отправить сообщение с файлом */
router.post('/api/messages', authenticateToken, (req, res) => {
  const { receiverId, content, type = 'text', fileUrl = '' } = req.body;
  if (!receiverId) return res.status(400).json({ error: 'Получатель обязателен' });

  // Шифруем контент и URL перед записью в БД
  const encryptedContent = encrypt(content || '');
  const encryptedFileUrl = encrypt(fileUrl || '');

  db.run('INSERT INTO messages (sender_id, receiver_id, content, type, file_url) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, receiverId, encryptedContent, type, encryptedFileUrl], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка отправки' });
      res.json({ success: true, messageId: this.lastID });
    });
});

/** Удалить переписку с пользователем */
router.delete('/api/messages/:userId', authenticateToken, (req, res) => {
  db.run('DELETE FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
    [req.user.id, req.params.userId, req.params.userId, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      res.json({ success: true, deleted: this.changes });
    });
});

/** Получить все диалоги */
router.get('/api/conversations', authenticateToken, (req, res) => {
  const uid = req.user.id;
  db.all(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.status,
      (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count,
      (SELECT content FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT sender_id FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_sender_id,
      (SELECT MAX(created_at) FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?)) as last_message_at
     FROM users u
     WHERE u.id != ? AND EXISTS (SELECT 1 FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id))
     ORDER BY last_message_at DESC`,
    [uid, uid, uid, uid, uid, uid, uid, uid, uid, uid],
    (err, conversations) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера: ' + err.message });
      // Расшифровываем last_message
      conversations.forEach(c => {
        c.last_message = decrypt(c.last_message);
      });
      res.json(conversations);
    });
});

/** История сообщений с пользователем (курсорная пагинация) */
router.get('/api/messages/:userId', authenticateToken, (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Некорректный ID' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const cursor = parseInt(req.query.cursor) || null;

  const baseQuery = `(m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)`;
  const cursorClause = cursor ? ' AND m.id < ?' : '';

  db.all(
    `SELECT m.id, m.sender_id, m.receiver_id, m.content, m.type, m.file_url, m.is_read, m.created_at
     FROM messages m
     WHERE ${baseQuery}${cursorClause}
     ORDER BY m.created_at DESC LIMIT ?`,
    cursor
      ? [req.user.id, targetId, targetId, req.user.id, cursor, limit]
      : [req.user.id, targetId, targetId, req.user.id, limit],
    (err, messages) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });

      // Расшифровываем контент и URL
      messages.forEach(m => {
        m.content = decrypt(m.content);
        m.file_url = decrypt(m.file_url);
      });

      db.run('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
        [targetId, req.user.id]);

      messages.reverse();
      const nextCursor = messages.length > 0 ? messages[0].id : null;

      res.json({ messages, nextCursor, hasMore: messages.length === limit });
    });
});

module.exports = router;
