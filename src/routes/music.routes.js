/**
 * Маршруты музыки
 * GET    /api/music
 * POST   /api/music/upload
 * DELETE /api/music/:id
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

// Явно указываем путь к ffmpeg для корректной работы на HF Spaces
ffmpeg.setFfmpegPath('ffmpeg');
const db = require('../../config/database');
const { authenticateToken } = require('../middleware/auth');

const musicDir = path.join(__dirname, '..', '..', 'public', 'media', 'music');
if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, musicDir),
    filename: (_, file, cb) => {
      const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      cb(null, `music-${uid}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB лимит на вход (после сжатия будет меньше)
  fileFilter: (_, file, cb) => {
    const allowed = /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error('Только аудио (mp3, wav, ogg, flac, m4a, aac, wma)'));
  }
});

/** Получить все треки */
router.get('/api/music', authenticateToken, (req, res) => {
  db.all(
    `SELECT mt.id, mt.user_id, mt.filename, mt.original_name, mt.title, mt.artist, mt.duration, mt.created_at,
            u.username, u.display_name, u.avatar
     FROM music_tracks mt INNER JOIN users u ON mt.user_id = u.id
     ORDER BY mt.created_at DESC`,
    [], (err, tracks) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(tracks);
    }
  );
});

/** Получить треки пользователя */
router.get('/api/music/user/:userId', authenticateToken, (req, res) => {
  db.all(
    `SELECT id, filename, original_name, title, artist, duration, created_at
     FROM music_tracks WHERE user_id = ? ORDER BY created_at DESC`,
    [req.params.userId], (err, tracks) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(tracks);
    }
  );
});

/** Загрузить трек (с конвертацией в MP3 128kbps) */
router.post('/api/music/upload', authenticateToken, upload.single('audio'), async (req, res) => {
  console.log('[music] Upload request received');
  console.log('[music] File:', req.file ? req.file.originalname : 'none');
  console.log('[music] Body:', req.body);

  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  const { title, artist, duration } = req.body || {};
  const originalPath = req.file.path;
  const isMp3 = path.extname(req.file.originalname).toLowerCase() === '.mp3';
  // Если уже MP3 — используем оригинальный файл, иначе конвертируем
  const finalPath = isMp3 ? originalPath : originalPath.replace(/\.[^.]+$/, '.mp3');

  console.log('[music] Original path:', originalPath);
  console.log('[music] Is MP3:', isMp3);
  console.log('[music] Final path:', finalPath);

  try {
    // Конвертируем только если не MP3
    if (!isMp3) {
      await new Promise((resolve, reject) => {
        ffmpeg(originalPath)
          .audioBitrate(128)
          .format('mp3')
          .on('end', resolve)
          .on('error', reject)
          .save(finalPath);
      });
      // Удаляем оригинальный файл
      try { fs.unlinkSync(originalPath); } catch(e) {}
    }

    // Запись в БД
    db.run(
      'INSERT INTO music_tracks (user_id, filename, original_name, title, artist, duration) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, path.basename(finalPath), req.file.originalname, (title || '').trim(), (artist || '').trim(), parseInt(duration) || 0],
      function (err) {
        if (err) {
          try { fs.unlinkSync(finalPath); } catch(e) {}
          return res.status(500).json({ error: 'Ошибка сохранения в БД' });
        }
        console.log('[music] Track saved to DB, id:', this.lastID);
        res.json({
          success: true,
          id: this.lastID,
          filename: path.basename(finalPath),
          original_name: req.file.originalname
        });
      }
    );
  } catch (err) {
    console.error('[music] Upload error:', err);
    // Чистка файлов при ошибке
    try { fs.unlinkSync(originalPath); } catch(e) {}
    try { fs.unlinkSync(finalPath); } catch(e) {}
    res.status(500).json({ error: 'Ошибка обработки аудио' });
  }
});

/** Удалить трек */
router.delete('/api/music/:id', authenticateToken, (req, res) => {
  db.get('SELECT user_id, filename FROM music_tracks WHERE id = ?', [req.params.id], (err, track) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!track) return res.status(404).json({ error: 'Трек не найден' });
    if (track.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

    db.run('DELETE FROM music_tracks WHERE id = ?', [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      // Удаляем файл
      const filePath = path.join(musicDir, track.filename);
      try { fs.unlinkSync(filePath); } catch {}
      res.json({ success: true });
    });
  });
});

module.exports = router;
