const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { checkMagicBytesFile } = require('../utils/magicBytes');
const { createUpload } = require('../utils/uploadFactory');

const avatarsDir = path.join(__dirname, '..', '..', 'public', 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const upload = createUpload({
  dest: avatarsDir,
  prefix: 'avatar',
  maxSize: 5 * 1024 * 1024,
  allowedExt: /jpeg|jpg|png|gif|webp/i,
  errorMsg: 'Только изображения (jpeg, jpg, png, gif, webp)'
});

async function compressAvatar(filePath) {
  await sharp(filePath)
    .resize(256, 256, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 80, progressive: true })
    .toFile(filePath + '.tmp');
  fs.renameSync(filePath + '.tmp', filePath);
}

async function validateImageMagic(req, res, next) {
  if (!req.file) return next();

  const mimeType = checkMagicBytesFile(req.file.path);
  if (!mimeType) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Файл не является допустимым изображением' });
  }

  try {
    await compressAvatar(req.file.path);
    // Переименовываем в .jpg
    const jpgPath = req.file.path.replace(/\.[^.]+$/, '.jpg');
    if (req.file.path !== jpgPath) {
      fs.renameSync(req.file.path, jpgPath);
      req.file.path = jpgPath;
      req.file.filename = path.basename(jpgPath);
    }
    next();
  } catch (err) {
    console.error('[avatar] Ошибка сжатия:', err.message);
    next(); // если сжатие не удалось — всё равно пропускаем
  }
}

module.exports = { upload, validateImageMagic };
