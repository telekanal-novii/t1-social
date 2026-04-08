/**
 * Проверка magic bytes файла (сигнатуры)
 * Универсальная утилита для аватаров, постов и медиа чата
 */
const fs = require('fs');

/**
 * Определяет MIME-тип по magic bytes буфера
 * @param {Buffer} buffer — данные файла (минимум 16 байт)
 * @param {number} bytesRead — сколько байт прочитано
 * @returns {string|false} — MIME тип или false
 */
function checkMagicBytes(buffer, bytesRead) {
  if (!buffer || bytesRead < 4) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  // WebP: RIFF .... WEBP (проверяем WEBP на смещении 8)
  if (bytesRead >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  // MP3 (ID3v2): 49 44 33
  if (bytesRead >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'audio/mpeg';
  // MP3 без ID3: FF FB или FF F3
  if (buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xF3)) return 'audio/mpeg';
  // WAV: RIFF .... WAVE
  if (bytesRead >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) return 'audio/wav';
  // OGG: 4F 67 67 53
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'audio/ogg';
  // MP4: .... ftyp
  if (bytesRead >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return 'video/mp4';
  // WebM/MKV: 1A 45 DF A3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'video/webm';
  // AVI: RIFF .... AVI 
  if (bytesRead >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49 && buffer[11] === 0x20) return 'video/avi';

  return false;
}

/**
 * Проверяет magic bytes файла по пути
 * @param {string} filePath — путь к файлу
 * @returns {string|false} — MIME тип или false
 */
function checkMagicBytesFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    return checkMagicBytes(buffer, bytesRead);
  } catch {
    return false;
  }
}

module.exports = { checkMagicBytes, checkMagicBytesFile };
