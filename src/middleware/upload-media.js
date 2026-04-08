const multer = require('multer');
const path = require('path');
const fs = require('fs');

const mediaDir = path.join(__dirname, '..', '..', 'public', 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

/**
 * Проверяет magic bytes файла (сигнатуры)
 * @param {Buffer} buffer
 * @param {number} bytesRead
 * @returns {string|false}
 */
function checkMagicBytes(buffer, bytesRead) {
  if (!buffer || bytesRead < 4) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  // WebP: 52 49 46 46
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  // MP3 (ID3v2): 49 44 33
  if (bytesRead >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'audio/mpeg';
  // MP3 без ID3: FF FB или FF F3
  if (buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xF3)) return 'audio/mpeg';
  // WAV: 52 49 46 46 ... 57 41 56 45
  if (bytesRead >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) return 'audio/wav';
  // OGG: 4F 67 67 53
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'audio/ogg';
  // MP4: ... 66 74 79 70
  if (bytesRead >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return 'video/mp4';
  // WebM/MKV: 1A 45 DF A3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'video/webm';
  // AVI: 52 49 46 46 ... 41 56 49 20
  if (bytesRead >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49 && buffer[11] === 0x20) return 'video/avi';

  return false;
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, mediaDir),
  filename: (_, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'msg-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp3|wav|ogg|mp4|webm|mkv|avi)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error('Неподдерживаемый формат'));
  }
});

/** Middleware для проверки magic bytes ПОСЛЕ сохранения */
function validateMediaMagic(req, res, next) {
  if (!req.file) return next();

  try {
    const fd = fs.openSync(req.file.path, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    const mimeType = checkMagicBytes(buffer, bytesRead);
    if (!mimeType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Файл не является допустимым медиа файлом' });
    }
  } catch {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Ошибка проверки файла' });
  }

  next();
}

module.exports = { upload, validateMediaMagic };
