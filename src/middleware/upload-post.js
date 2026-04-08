const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { checkMagicBytesFile } = require('../utils/magicBytes');
const { createUpload } = require('../utils/uploadFactory');

const mediaDir = path.join(__dirname, '..', '..', 'public', 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

const upload = createUpload({
  dest: mediaDir,
  prefix: 'post',
  maxSize: 10 * 1024 * 1024,
  allowedExt: /\.(jpg|jpeg|png|gif|webp)$/i,
  errorMsg: 'Только изображения (jpg, png, gif, webp)'
});

/** Middleware для проверки magic bytes ПОСЛЕ сохранения */
async function validateImageMagic(req, res, next) {
  if (!req.file) return next();

  try {
    const mimeType = checkMagicBytesFile(req.file.path);
    if (!mimeType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Файл не является допустимым изображением' });
    }

    // Сжимаем изображение
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.gif') {
      if (ext === '.png') {
        await sharp(req.file.path)
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 8 })
          .toFile(req.file.path + '.tmp');
      } else {
        await sharp(req.file.path)
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 75, progressive: true })
          .toFile(req.file.path + '.tmp');
      }
      fs.renameSync(req.file.path + '.tmp', req.file.path);

      // Меняем расширение на .jpg для JPEG
      if (ext !== '.png') {
        const jpgPath = req.file.path.replace(/\.[^.]+$/, '.jpg');
        if (req.file.path !== jpgPath) {
          fs.renameSync(req.file.path, jpgPath);
          req.file.path = jpgPath;
          req.file.filename = path.basename(jpgPath);
        }
      }
    }
  } catch (err) {
    console.error('[post] Ошибка обработки изображения:', err.message);
    try { fs.unlinkSync(req.file.path); } catch {}
    try { fs.unlinkSync(req.file.path + '.tmp'); } catch {}
  }

  next();
}

module.exports = { upload, validateImageMagic };
