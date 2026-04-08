const multer = require('multer');
const path = require('path');
const fs = require('fs');

const avatarsDir = path.join(__dirname, '..', '..', 'public', 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

/**
 * Проверяет magic bytes файла (сигнатуры)
 * Читает только первые 12 байт — не грузит весь файл
 * @param {string} filePath - путь к файлу
 * @returns {string|false} - MIME тип или false
 */
function checkMagicBytesFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    if (bytesRead < 4) return false;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
    // WebP: 52 49 46 46
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';

    return false;
  } catch {
    return false;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    req._uploadDir = avatarsDir;
    cb(null, avatarsDir);
  },
  filename: (_, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = /jpeg|jpg|png|gif|webp/;
    const ext = allowedExt.test(path.extname(file.originalname).toLowerCase());

    if (!ext) {
      return cb(new Error('Только изображения (jpeg, jpg, png, gif, webp)'));
    }

    cb(null, true);
  }
});

// Middleware для проверки magic bytes ПОСЛЕ сохранения файла
function validateImageMagic(req, res, next) {
  if (!req.file) return next();

  const mimeType = checkMagicBytesFile(req.file.path);
  if (!mimeType) {
    // Удаляем файл с недопустимыми magic bytes
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Файл не является допустимым изображением' });
  }

  next();
}

module.exports = { upload, validateImageMagic };
