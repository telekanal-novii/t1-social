const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Создаёт multer-инстанс с нужными параметрами
 * @param {Object} options
 * @param {string} options.dest — директория для сохранения
 * @param {string} options.prefix — префикс имени файла
 * @param {number} options.maxSize — максимальный размер в байтах
 * @param {RegExp} options.allowedExt — regex допустимых расширений
 * @param {string} options.errorMsg — сообщение об ошибке
 * @returns {multer.Multer}
 */
function createUpload({ dest, prefix = 'file', maxSize = 10 * 1024 * 1024, allowedExt = /./, errorMsg = 'Недопустимый формат файла' }) {
  const uploadDir = path.resolve(dest);
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => {
      const uid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      cb(null, `${prefix}-${uid}${path.extname(file.originalname)}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter: (_, file, cb) => {
      if (allowedExt.test(file.originalname)) cb(null, true);
      else cb(new Error(errorMsg));
    }
  });
}

module.exports = { createUpload };
