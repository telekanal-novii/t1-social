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
router.post('/api/music/upload', authenticateToken, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  const { title, artist, duration } = req.body || {};
  const originalPath = req.file.path;
  // Всегда конвертируем в MP3 для экономии места и унификации
  const finalPath = originalPath.replace(/\.[^.]+$/, '.mp3');

  const finalize = (error) => {
    if (error) {
      console.error('[music] Upload error:', error);
      // Чистка файлов при ошибке
      try { fs.unlinkSync(originalPath); } catch(e) {}
      try { fs.unlinkSync(finalPath); } catch(e) {}
      return res.status(500).json({ error: 'Ошибка обработки аудио' });
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
        res.json({ 
          success: true, 
          id: this.lastID, 
          filename: path.basename(finalPath), 
          original_name: req.file.originalname 
        });
      }
    );
  };

  // Запуск конвертации
  ffmpeg(originalPath)
    .audioBitrate(128)
    .format('mp3')
    .on('end', () => {
      // Удаляем оригинальный файл (он больше не нужен)
      try { fs.unlinkSync(originalPath); } catch(e) {}
      finalize(null);
    })
    .on('error', (err) => {
      finalize(err);
    })
    .save(finalPath);
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
