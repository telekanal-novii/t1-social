/**
 * Криптографические утилиты — шифрование БД
 * AES-256-GCM для защиты данных на диске
 */
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Шифрует строку
 * @param {string} text
 * @returns {string} — base64(iv + authTag + ciphertext)
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') return text;
  if (!ENCRYPTION_KEY) return text; // нет ключа — не шифруем

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // iv (16) + authTag (16) + ciphertext
  return iv.toString('base64') + ':' + authTag.toString('base64') + ':' + encrypted;
}

/**
 * Расшифровывает строку
 * @param {string} encrypted — base64(iv):base64(authTag):base64(ciphertext)
 * @returns {string}
 */
function decrypt(encrypted) {
  if (!encrypted || typeof encrypted !== 'string') return encrypted || '';
  if (!ENCRYPTION_KEY) return encrypted;
  // Если не зашифровано (нет ':'), возвращаем как есть
  if (!encrypted.includes(':')) return encrypted;

  try {
    const parts = encrypted.split(':');
    if (parts.length !== 3) return encrypted;

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Если не удалось расшифровать — возвращаем как есть (старые данные)
    return encrypted;
  }
}

module.exports = { encrypt, decrypt };
