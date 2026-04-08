const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { checkMagicBytes } = require('../utils/magicBytes');
const { createUpload } = require('../utils/uploadFactory');

const mediaDir = path.join(__dirname, '..', '..', 'public', 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

const upload = createUpload({
  dest: mediaDir,
  prefix: 'msg',
  maxSize: 50 * 1024 * 1024,
  allowedExt: /\.(jpg|jpeg|png|gif|webp|mp3|wav|ogg|mp4|webm|mkv|avi)$/i,
  errorMsg: 'Неподдерживаемый формат'
});

async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  // Не сжимаем GIF (анимации)
  if (ext === '.gif') return;

  try {
    // JPEG — сжимаем как JPEG
    if (ext === '.jpg' || ext === '.jpeg') {
      await sharp(filePath)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75, progressive: true })
        .toFile(filePath + '.tmp');
      fs.renameSync(filePath + '.tmp', filePath);
    }
    // PNG/WebP — сохраняем в том же формате с прозрачностью
    else if (ext === '.png') {
      await sharp(filePath)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 8 })
        .toFile(filePath + '.tmp');
      fs.renameSync(filePath + '.tmp', filePath);
    }
    else if (ext === '.webp') {
      await sharp(filePath)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(filePath + '.tmp');
      fs.renameSync(filePath + '.tmp', filePath);
    }
  } catch (err) {
    console.error('[media] Ошибка сжатия:', err.message);
    // Удаляем временный файл если остался
    try { fs.unlinkSync(filePath + '.tmp'); } catch {}
  }
}

async function validateMediaMagic(req, res, next) {
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

    // Сжимаем только изображения
    const imgMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (imgMimes.includes(mimeType)) {
      await compressImage(req.file.path);
      // Меняем расширение на .jpg
      const jpgPath = req.file.path.replace(/\.[^.]+$/, '.jpg');
      if (req.file.path !== jpgPath) {
        fs.renameSync(req.file.path, jpgPath);
        req.file.path = jpgPath;
        req.file.filename = path.basename(jpgPath);
        req.file.mimetype = 'image/jpeg';
      }
    }

    next();
  } catch (err) {
    console.error('[media] Ошибка обработки:', err.message);
    next();
  }
}

module.exports = { upload, validateMediaMagic };
