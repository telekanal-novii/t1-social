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
const fsPromises = require('fs').promises;
const multer = require('multer');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../config/database');
const { authenticateToken } = require('../middleware/auth');
const { dbAll, dbGet, dbRun } = require('../utils/db');

// Явно указываем путь к ffmpeg
ffmpeg.setFfmpegPath('ffmpeg');

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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_, file, cb) => {
    const allowed = /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error('Только аудио (mp3, wav, ogg, flac, m4a, aac, wma)'));
  }
});

/**
 * GET /api/music
 * Получить все треки (с пагинацией)
 */
router.get('/api/music', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const offset = parseInt(req.query.offset) || 0;

    const tracks = await dbAll(
      `SELECT mt.id, mt.user_id, mt.filename, mt.original_name, mt.title, mt.artist, mt.duration, mt.created_at,
              u.username, u.display_name, u.avatar
       FROM music_tracks mt INNER JOIN users u ON mt.user_id = u.id
       ORDER BY mt.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json(tracks);
  } catch (err) {
    console.error('[music:list] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/music/user/:userId
 * Получить треки пользователя
 */
router.get('/api/music/user/:userId', authenticateToken, async (req, res) => {
  try {
    const tracks = await dbAll(
      `SELECT id, filename, original_name, title, artist, duration, created_at
       FROM music_tracks WHERE user_id = ? ORDER BY created_at DESC`,
      [req.params.userId]
    );
    res.json(tracks);
  } catch (err) {
    console.error('[music:user] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/music/upload
 * Загрузить трек (с конвертацией в MP3 128kbps)
 */
router.post('/api/music/upload', authenticateToken, upload.single('audio'), async (req, res) => {
  console.log('[music:upload] Request received');
  console.log('[music:upload] User:', req.user?.id);
  console.log('[music:upload] File:', req.file);
  console.log('[music:upload] Body:', req.body);
  
  try {
    if (!req.file) {
      console.error('[music:upload] No file received');
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const { title, artist, duration } = req.body || {};
    const originalPath = req.file.path;
    const isMp3 = path.extname(req.file.originalname).toLowerCase() === '.mp3';
    const finalPath = isMp3 ? originalPath : originalPath.replace(/\.[^.]+$/, '.mp3');

    console.log('[music:upload] Original path:', originalPath);
    console.log('[music:upload] Is MP3:', isMp3);
    console.log('[music:upload] Final path:', finalPath);

    // Конвертируем только если не MP3
    if (!isMp3) {
      console.log('[music:upload] Converting to MP3...');
      await new Promise((resolve, reject) => {
        ffmpeg(originalPath)
          .audioBitrate(128)
          .format('mp3')
          .on('end', () => {
            console.log('[music:upload] Conversion complete');
            resolve();
          })
          .on('error', (err) => {
            console.error('[music:upload] Conversion error:', err.message);
            reject(err);
          })
          .save(finalPath);
      });
      // Удаляем оригинальный файл
      await fsPromises.unlink(originalPath).catch(() => {});
    }

    // Запись в БД
    console.log('[music:upload] Saving to database...');
    const { lastID } = await dbRun(
      'INSERT INTO music_tracks (user_id, filename, original_name, title, artist, duration) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, path.basename(finalPath), req.file.originalname, (title || '').trim(), (artist || '').trim(), parseInt(duration) || 0]
    );

    console.log('[music:upload] Success, id:', lastID);
    res.json({
      success: true,
      id: lastID,
      filename: path.basename(finalPath),
      original_name: req.file.originalname
    });
  } catch (err) {
    console.error('[music:upload] Error:', err.message);
    console.error('[music:upload] Stack:', err.stack);
    // Чистка файлов при ошибке
    if (req.file?.path) await fsPromises.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: 'Ошибка обработки аудио: ' + err.message });
  }
});

/**
 * DELETE /api/music/:id
 * Удалить трек
 */
router.delete('/api/music/:id', authenticateToken, async (req, res) => {
  try {
    const track = await dbGet('SELECT user_id, filename FROM music_tracks WHERE id = ?', [req.params.id]);
    
    if (!track) {
      return res.status(404).json({ error: 'Трек не найден' });
    }
    if (track.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Нет прав' });
    }

    await dbRun('DELETE FROM music_tracks WHERE id = ?', [req.params.id]);
    
    // Удаляем файл
    const filePath = path.join(musicDir, track.filename);
    await fsPromises.unlink(filePath).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[music:delete] Ошибка:', err.message);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
