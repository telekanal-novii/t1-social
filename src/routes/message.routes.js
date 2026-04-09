/**
 * Маршруты сообщений — современный мессенджер
 * 
 * POST   /api/messages/upload        — загрузить файл
 * POST   /api/messages               — отправить сообщение
 * PUT    /api/messages/:id           — редактировать
 * DELETE /api/messages/:id           — удалить (soft)
 * POST   /api/messages/:id/reaction  — реакция
 * DELETE /api/messages/:id/reaction  — убрать реакцию
 * GET    /api/messages/:id/reactions — получить реакции
 * DELETE /api/messages/:userId       — удалить переписку
 * GET    /api/messages/count         — счётчик непрочитанных
 * PUT    /api/messages/read/:userId  — отметить прочитанными
 * GET    /api/messages/:userId       — история
 * GET    /api/conversations          — диалоги
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/crypto');
const { dbRun, dbGet, dbAll } = require('../utils/db');

// ===== НАСТРОЙКИ =====
const MEDIA_DIR = path.join(__dirname, '..', '..', 'public', 'media', 'messages');
const THUMB_DIR = path.join(__dirname, '..', '..', 'public', 'media', 'thumbs');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

// ===== ЗАГРУЗКА ФАЙЛОВ =====

// Валидация magic bytes
const MAGIC_BYTES = {
  jpg:  [[0xFF, 0xD8, 0xFF]],
  png:  [[0x89, 0x50, 0x4E, 0x47]],
  gif:  [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46], null, null, null, [0x57, 0x45, 0x42, 0x50]],
  mp3:  [[0xFF, 0xFB], [0xFF, 0xF3], [0x49, 0x44, 0x33]],
  mp4:  [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]],
  webm: [[0x1A, 0x45, 0xDF, 0xA3]]
};

function checkMagicBytes(buf) {
  for (const [ext, patterns] of Object.entries(MAGIC_BYTES)) {
    for (const pattern of patterns) {
      if (!pattern) continue;
      let match = true;
      for (let i = 0; i < pattern.length; i++) {
        if (buf[i] !== pattern[i]) { match = false; break; }
      }
      if (match) return ext;
    }
  }
  return null;
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, MEDIA_DIR),
  filename: (_, file, cb) => {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    cb(null, `${id}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|mp3|wav|ogg|mp4|webm)$/i.test(file.originalname);
    cb(ok ? null : new Error('Неподдерживаемый формат'), ok);
  }
});

// ===== ЗАГРУЗКА =====
router.post('/api/messages/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    // Проверяем magic bytes
    const buf = fs.readFileSync(req.file.path).slice(0, 16);
    const detected = checkMagicBytes(buf);
    
    // Определяем тип
    const ext = path.extname(req.file.originalname).toLowerCase();
    let type = 'file';
    if (/\.(jpg|jpeg|png|gif|webp)$/.test(ext) || detected && ['jpg','png','gif','webp'].includes(detected)) type = 'image';
    else if (/\.(mp3|wav|ogg)$/.test(ext) || detected && ['mp3'].includes(detected)) type = 'audio';
    else if (/\.(mp4|webm)$/.test(ext) || detected && ['mp4','webm'].includes(detected)) type = 'video';

    if (type === 'file') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Недопустимый файл' });
    }

    const fileUrl = `/media/messages/${req.file.filename}`;
    let thumbUrl = null;
    let width = null, height = null;

    // Создаём превью для картинок
    if (type === 'image' && !ext.includes('gif') && detected !== 'gif') {
      try {
        const meta = await sharp(req.file.path).metadata();
        width = meta.width; height = meta.height;

        const thumbName = `thumb_${path.parse(req.file.filename).name}.jpg`;
        const thumbPath = path.join(THUMB_DIR, thumbName);
        await sharp(req.file.path)
          .resize(400, 400, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toFile(thumbPath);
        thumbUrl = `/media/thumbs/${thumbName}`;
      } catch (e) {
        console.error('[upload:thumb]', e.message);
      }
    }

    res.json({ success: true, fileUrl, thumbUrl, type, fileName: req.file.originalname, size: req.file.size, width, height });
  } catch (e) {
    console.error('[upload]', e.message);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// ===== ОТПРАВКА =====
router.post('/api/messages', authenticateToken, async (req, res) => {
  const { receiverId, content, type = 'text', fileUrl = '', fileName = '', thumbUrl = '', replyTo = null } = req.body;
  const rid = parseInt(receiverId);

  if (!rid || isNaN(rid)) return res.status(400).json({ error: 'Некорректный ID' });
  if (rid === req.user.id) return res.status(400).json({ error: 'Нельзя себе' });

  const user = await dbGet('SELECT id FROM users WHERE id = ?', [rid]);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  if (!content?.trim() && !fileUrl) return res.status(400).json({ error: 'Пустое сообщение' });
  if (content && content.length > 4000) return res.status(400).json({ error: 'Слишком длинное' });

  // Проверяем reply_to
  let replyMsg = null;
  if (replyTo) {
    replyMsg = await dbGet('SELECT id, sender_id, content FROM messages WHERE id = ?', [replyTo]);
    if (!replyMsg) return res.status(400).json({ error: 'Сообщение для ответа не найдено' });
  }

  // Сохраняем
  const { lastID } = await dbRun(
    'INSERT INTO messages (sender_id, receiver_id, content, type, file_url, file_name, thumb_url, reply_to) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, rid, content || '', type, encrypt(fileUrl||''), encrypt(fileName||''), encrypt(thumbUrl||''), replyTo]
  );

  // Уведомляем
  const io = req.app.locals.io;
  if (io) {
    const { connectedUsers } = require('../socket/socket');
    const sockets = connectedUsers.get(rid);
    if (sockets) {
      sockets.forEach(sid => {
        io.to(sid).emit('new_message', {
          id: lastID, sender_id: req.user.id, content: content || '', type,
          file_url: fileUrl, file_name: fileName, thumb_url: thumbUrl,
          reply_to: replyTo, reply_content: replyMsg?.content || '',
          is_read: 0, created_at: new Date().toISOString()
        });
      });
    }
  }

  res.json({ success: true, messageId: lastID });
});

// ===== РЕДАКТИРОВАНИЕ =====
router.put('/api/messages/:id', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Пустое сообщение' });
  if (content.length > 4000) return res.status(400).json({ error: 'Слишком длинное' });

  const msg = await dbGet('SELECT * FROM messages WHERE id=?', [req.params.id]);
  if (!msg) return res.status(404).json({ error: 'Не найдено' });
  if (msg.sender_id != req.user.id) return res.status(403).json({ error: 'Нет прав' });
  if (msg.is_deleted) return res.status(400).json({ error: 'Сообщение удалено' });

  await dbRun('UPDATE messages SET content=?, edited_at=CURRENT_TIMESTAMP WHERE id=?', [content.trim(), req.params.id]);
  res.json({ success: true, editedAt: new Date().toISOString() });
});

// ===== УДАЛЕНИЕ =====
router.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  const msg = await dbGet('SELECT * FROM messages WHERE id=?', [req.params.id]);
  if (!msg) return res.status(404).json({ error: 'Не найдено' });
  if (msg.sender_id != req.user.id && msg.receiver_id != req.user.id) return res.status(403).json({ error: 'Нет прав' });

  await dbRun('UPDATE messages SET is_deleted=1, content="[Сообщение удалено]" WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// ===== РЕАКЦИИ =====
router.post('/api/messages/:id/reaction', authenticateToken, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Эмодзи обязателен' });

  const msg = await dbGet('SELECT id FROM messages WHERE id=?', [req.params.id]);
  if (!msg) return res.status(404).json({ error: 'Не найдено' });

  try {
    await dbRun('INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji) VALUES (?,?,?)', [req.params.id, req.user.id, emoji]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

router.delete('/api/messages/:id/reaction', authenticateToken, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Эмодзи обязателен' });
  await dbRun('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?', [req.params.id, req.user.id, emoji]);
  res.json({ success: true });
});

router.get('/api/messages/:id/reactions', authenticateToken, async (req, res) => {
  const reactions = await dbAll(
    'SELECT mr.emoji, COUNT(*) as count FROM message_reactions mr WHERE mr.message_id=? GROUP BY mr.emoji',
    [req.params.id]
  );
  res.json(reactions);
});

// ===== УДАЛИТЬ ПЕРЕПИСКУ =====
router.delete('/api/messages/:userId', authenticateToken, async (req, res) => {
  const tid = parseInt(req.params.userId);
  if (isNaN(tid)) return res.status(400).json({ error: 'Некорректный ID' });

  await dbRun('DELETE FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)', [req.user.id, tid, tid, req.user.id]);
  res.json({ success: true });
});

// ===== СЧЁТЧИК =====
router.get('/api/messages/count', authenticateToken, async (req, res) => {
  const { count } = await dbGet('SELECT COUNT(*) as count FROM messages WHERE receiver_id=? AND is_read=0', [req.user.id]);
  res.json({ count: count || 0 });
});

// ===== ПРОЧИТАНО =====
router.put('/api/messages/read/:userId', authenticateToken, async (req, res) => {
  const tid = parseInt(req.params.userId);
  if (isNaN(tid)) return res.status(400).json({ error: 'Некорректный ID' });
  const { changes } = await dbRun('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0', [tid, req.user.id]);
  res.json({ success: true, markedRead: changes });
});

// ===== ДИАЛОГИ =====
router.get('/api/conversations', authenticateToken, async (req, res) => {
  const uid = req.user.id;
  const convs = await dbAll(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.status,
      (SELECT COUNT(*) FROM messages WHERE sender_id=u.id AND receiver_id=? AND is_read=0) as unread_count,
      MAX(m.created_at) as last_at,
      (SELECT content FROM messages WHERE (sender_id=? AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=?) ORDER BY created_at DESC LIMIT 1) as last_msg,
      (SELECT sender_id FROM messages WHERE (sender_id=? AND receiver_id=u.id) OR (sender_id=u.id AND receiver_id=?) ORDER BY created_at DESC LIMIT 1) as last_sender
     FROM users u
     LEFT JOIN messages m ON (m.sender_id=u.id OR m.receiver_id=u.id)
     WHERE u.id!=?
     GROUP BY u.id
     HAVING COUNT(m.id)>0
     ORDER BY last_at DESC`,
    [uid, uid, uid, uid, uid, uid]
  );
  convs.forEach(c => {
    try { c.last_message = decrypt(c.last_msg); } catch { c.last_message = ''; }
    delete c.last_msg; delete c.last_at;
  });
  res.json(convs);
});

// ===== ИСТОРИЯ =====
router.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  const tid = parseInt(req.params.userId);
  if (isNaN(tid) || tid === req.user.id) return res.status(400).json({ error: 'Некорректный ID' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;

  const msgs = await dbAll(
    `SELECT m.id, m.sender_id, m.receiver_id, m.content, m.type, m.file_url, m.file_name, m.thumb_url, m.is_read, m.edited_at, m.is_deleted, m.reply_to, m.created_at
     FROM messages m
     WHERE (m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?)
     ${cursor ? 'AND m.id < ?' : ''}
     ORDER BY m.id DESC LIMIT ?`,
    cursor ? [req.user.id, tid, tid, req.user.id, cursor, limit] : [req.user.id, tid, tid, req.user.id, limit]
  );

  msgs.forEach(m => {
    try { m.file_url = decrypt(m.file_url || ''); } catch { m.file_url = ''; }
    try { m.file_name = decrypt(m.file_name || ''); } catch { m.file_name = ''; }
    try { m.thumb_url = decrypt(m.thumb_url || ''); } catch { m.thumb_url = ''; }
  });

  msgs.reverse();
  const hasMore = msgs.length === limit;
  const nextCursor = msgs.length ? msgs[0].id : null;

  await dbRun('UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0', [tid, req.user.id]);

  res.json({ messages: msgs, nextCursor, hasMore, targetId: tid });
});

module.exports = router;
