/**
 * Универсальный модуль загрузки файлов
 * 
 * Поддерживает:
 * - Аватарки (сжатие 256x256)
 * - Посты (сжатие 800x800)
 * - Медиа сообщения (сжатие 1920x1920)
 * 
 * usage:
 *   const { createUploader } = require('./middleware/upload');
 *   const avatarUpload = createUploader('avatar');
 *   const postUpload = createUploader('post');
 *   const mediaUpload = createUploader('media');
 */

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { checkMagicBytesFile } = require('../utils/magicBytes');
const { createUpload } = require('../utils/uploadFactory');

// ======================== КОНФИГУРАЦИЯ ========================

const UPLOAD_CONFIGS = {
  // Аватарки
  avatar: {
    dest: path.join(__dirname, '..', '..', 'public', 'avatars'),
    prefix: 'avatar',
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedExt: /\.(jpg|jpeg|png|gif|webp)$/i,
    errorMsg: 'Только изображения (jpeg, jpg, png, gif, webp)',
    resize: {
      width: 256,
      height: 256,
      fit: 'cover',
      position: 'center'
    },
    outputFormat: 'jpg',
    outputQuality: 80,
    field: 'avatar'
  },

  // Посты (изображения к постам)
  post: {
    dest: path.join(__dirname, '..', '..', 'public', 'media'),
    prefix: 'post',
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedExt: /\.(jpg|jpeg|png|gif|webp)$/i,
    errorMsg: 'Только изображения (jpg, png, gif, webp)',
    resize: {
      width: 800,
      height: 800,
      fit: 'inside',
      withoutEnlargement: true
    },
    outputFormat: 'smart', // jpg для фото, png для PNG с прозрачностью
    outputQuality: 75,
    field: 'image'
  },

  // Медиа в сообщениях (изображения, аудио, видео)
  media: {
    dest: path.join(__dirname, '..', '..', 'public', 'media'),
    prefix: 'msg',
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedExt: /\.(jpg|jpeg|png|gif|webp|mp3|wav|ogg|flac|m4a|aac|mp4|webm|mkv|avi)$/i,
    errorMsg: 'Неподдерживаемый формат файла. Разрешены: изображения, аудио, видео',
    resize: {
      width: 1920,
      height: 1920,
      fit: 'inside',
      withoutEnlargement: true
    },
    outputFormat: 'smart',
    outputQuality: 80,
    compressAudio: true,    // Сжимать аудио
    compressVideo: true,    // Сжимать видео
    audioBitrate: '128k',   // Битрейт аудио
    videoPreset: 'medium',  // Пресет видео (ultrafast, medium, slow)
    videoCrf: 28,           // Качество видео (18-28)
    field: 'file'
  }
};

// ======================== СОЗДАНИЕ ЗАГРУЗЧИКА ========================

/**
 * Создаёт экземпляр загрузчика для конкретного типа
 * @param {string} type - 'avatar' | 'post' | 'media'
 * @returns {{ upload: multer.Multer, validate: Function }}
 */
function createUploader(type) {
  const config = UPLOAD_CONFIGS[type];
  
  if (!config) {
    throw new Error(`[upload] Unknown type: ${type}. Available: ${Object.keys(UPLOAD_CONFIGS).join(', ')}`);
  }

  // Создаём директорию если нет
  if (!fs.existsSync(config.dest)) {
    fs.mkdirSync(config.dest, { recursive: true });
  }

  // Создаём multer экземпляр
  const upload = createUpload({
    dest: config.dest,
    prefix: config.prefix,
    maxSize: config.maxSize,
    allowedExt: config.allowedExt,
    errorMsg: config.errorMsg
  });

  // Middleware для проверки magic bytes и сжатия
  const validate = async (req, res, next) => {
    if (!req.file) return next();

    try {
      console.log(`[upload:${type}] Processing file:`, req.file.originalname, 'at', req.file.path);
      
      // Проверяем magic bytes
      let mimeType;
      try {
        mimeType = checkMagicBytesFile(req.file.path);
      } catch (magicErr) {
        console.error(`[upload:${type}] Error checking magic bytes:`, magicErr.message);
        // Если не удалось проверить — пробуем определить по расширению
        const ext = path.extname(req.file.originalname).toLowerCase();
        const extToMime = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp'
        };
        mimeType = extToMime[ext] || null;
      }
      console.log(`[upload:${type}] Detected MIME:`, mimeType);

      if (!mimeType) {
        console.error(`[upload:${type}] Invalid magic bytes for`, req.file.originalname);
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: 'Файл не является допустимым файлом. Возможно, это повреждённый файл.'
        });
      }

      // Сжимаем только изображения (если включено)
      const isImage = mimeType.startsWith('image/');
      const isAudio = mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(req.file.originalname);
      const isVideo = mimeType.startsWith('video/') || /\.(mp4|webm|mkv|avi)$/i.test(req.file.originalname);
      
      const shouldCompress = isImage && (!config.compressOnlyImages || config.compressOnlyImages);

      console.log(`[upload:${type}] Is image:`, isImage, 'Is audio:', isAudio, 'Is video:', isVideo, 'Should compress image:', shouldCompress);

      if (shouldCompress && !mimeType.includes('gif')) {
        console.log(`[upload:${type}] Compressing image...`);
        await compressImage(req.file.path, config);
        console.log(`[upload:${type}] Compression complete`);

        // Меняем расширение на .jpg если нужно
        if (config.outputFormat === 'jpg' || mimeType === 'image/jpeg') {
          const jpgPath = req.file.path.replace(/\.[^.]+$/, '.jpg');
          if (req.file.path !== jpgPath) {
            console.log(`[upload:${type}] Renaming to .jpg`);
            fs.renameSync(req.file.path, jpgPath);
            req.file.path = jpgPath;
            req.file.filename = path.basename(jpgPath);
            req.file.mimetype = 'image/jpeg';
          }
        }
      } else if (isAudio && config.compressAudio) {
        console.log(`[upload:${type}] Compressing audio...`);
        const newPath = await compressAudio(req.file.path, config);
        req.file.path = newPath;
        req.file.filename = path.basename(newPath);
        req.file.mimetype = 'audio/mpeg';
        console.log(`[upload:${type}] Audio compression complete`);
      } else if (isVideo && config.compressVideo) {
        console.log(`[upload:${type}] Compressing video...`);
        const newPath = await compressVideo(req.file.path, config);
        req.file.path = newPath;
        req.file.filename = path.basename(newPath);
        req.file.mimetype = 'video/mp4';
        console.log(`[upload:${type}] Video compression complete`);
      }

      console.log(`[upload:${type}] Validation successful`);
      next();
    } catch (err) {
      console.error(`[upload:${type}] Ошибка обработки:`, err.message);
      console.error(`[upload:${type}] Stack:`, err.stack);
      
      // Удаляем файл если ошибка
      try { 
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (fs.existsSync(req.file.path + '.tmp')) fs.unlinkSync(req.file.path + '.tmp');
      } catch {}
      
      res.status(500).json({ error: 'Ошибка обработки файла. Попробуйте другой файл.' });
    }
  };

  return { upload, validate };
}

// ======================== СЖАТИЕ ИЗОБРАЖЕНИЙ ========================

/**
 * Сжимает изображение согласно конфигу
 * @param {string} filePath — путь к файлу
 * @param {Object} config — конфигурация
 */
async function compressImage(filePath, config) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Не сжимаем GIF
  if (ext === '.gif') return;

  const resizeOpts = config.resize;

  // Определяем формат вывода
  let outputExt = ext;
  let sharpPipeline;

  if (config.outputFormat === 'jpg') {
    // Принудительно JPG (для аватарок)
    sharpPipeline = sharp(filePath)
      .resize(resizeOpts.width, resizeOpts.height, resizeOpts)
      .jpeg({ quality: config.outputQuality, progressive: true });
    outputExt = '.jpg';
  } else if (ext === '.png') {
    // PNG сохраняем с прозрачностью
    sharpPipeline = sharp(filePath)
      .resize(resizeOpts.width, resizeOpts.height, resizeOpts)
      .png({ compressionLevel: 8 });
    outputExt = '.png';
  } else if (ext === '.webp') {
    sharpPipeline = sharp(filePath)
      .resize(resizeOpts.width, resizeOpts.height, resizeOpts)
      .webp({ quality: config.outputQuality });
    outputExt = '.webp';
  } else {
    // Всё остальное → JPEG
    sharpPipeline = sharp(filePath)
      .resize(resizeOpts.width, resizeOpts.height, resizeOpts)
      .jpeg({ quality: config.outputQuality, progressive: true });
    outputExt = '.jpg';
  }

  await sharpPipeline.toFile(filePath + '.tmp');
  fs.renameSync(filePath + '.tmp', filePath);

  // Переименовываем если расширение изменилось
  if (outputExt !== ext) {
    const newPath = filePath.replace(/\.[^.]+$/, outputExt);
    if (filePath !== newPath) {
      fs.renameSync(filePath, newPath);
      return newPath;
    }
  }
  
  return filePath;
}

// ======================== СЖАТИЕ АУДИО ========================

/**
 * Сжимает аудиофайл через FFmpeg
 * @param {string} filePath — путь к файлу
 * @param {Object} config — конфигурация
 */
function compressAudio(filePath, config) {
  return new Promise((resolve, reject) => {
    const outputPath = filePath + '.tmp.mp3';
    
    ffmpeg(filePath)
      .audioBitrate(config.audioBitrate || '128k')
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('end', () => {
        try {
          // Заменяем оригинальный файл
          fs.renameSync(outputPath, filePath);
          resolve(filePath);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error('[upload:audio] FFmpeg error:', err.message);
        // Удаляем временный файл
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        // Если ffmpeg недоступен — оставляем оригинал
        resolve(filePath);
      })
      .save(outputPath);
  });
}

// ======================== СЖАТИЕ ВИДЕО ========================

/**
 * Сжимает видеофайл через FFmpeg
 * @param {string} filePath — путь к файлу
 * @param {Object} config — конфигурация
 */
function compressVideo(filePath, config) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(filePath).toLowerCase();
    const outputPath = filePath + '.tmp.mp4';
    
    ffmpeg(filePath)
      .outputOptions([
        '-c:v libx264',
        `-crf ${config.videoCrf || 28}`,
        `-preset ${config.videoPreset || 'medium'}`,
        '-c:a aac',
        `-b:a ${config.audioBitrate || '128k'}`,
        '-movflags +faststart',
        '-vf scale=\'min(1920,iw):min(1080,ih):force_original_aspect_ratio=decrease\'',
      ])
      .format('mp4')
      .on('end', () => {
        try {
          // Заменяем оригинальный файл
          fs.renameSync(outputPath, filePath.replace(/\.[^.]+$/, '.mp4'));
          resolve(filePath.replace(/\.[^.]+$/, '.mp4'));
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error('[upload:video] FFmpeg error:', err.message);
        // Удаляем временный файл
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
        // Если ffmpeg недоступен — оставляем оригинал
        resolve(filePath);
      })
      .save(outputPath);
  });
}

// ======================== BACKWARD COMPATIBILITY ========================

// Для обратной совместимости экспортируем старые имена
const avatarUpload = createUploader('avatar');
const postUpload = createUploader('post');
const mediaUpload = createUploader('media');

module.exports = {
  // Новый API
  createUploader,
  
  // Старый API (для обратной совместимости)
  upload: avatarUpload.upload,
  validateImageMagic: avatarUpload.validate,
  
  // Для постов
  postUpload: postUpload.upload,
  validatePostImage: postUpload.validate,
  
  // Для медиа
  mediaUpload: mediaUpload.upload,
  validateMediaMagic: mediaUpload.validate
};
