/**
 * E2E шифрование на клиенте — Web Crypto API
 * RSA-OAEP (4096-bit) + AES-GCM (256-bit) гибридная схема
 *
 * При отправке сообщения:
 *   1. Генерируется случайный AES-256 ключ
 *   2. Сообщение шифруется AES-GCM
 *   3. AES-ключ шифруется RSA-OAEP публичным ключом получателя
 *   4. Отправляется: encryptedMessage + encryptedAESKey + iv
 *
 * При получении:
 *   1. Приватным RSA-ключом расшифровывается AES-ключ
 *   2. AES-ключом расшифровывается сообщение
 */

const E2E = {
  /** @type {CryptoKey|null} */
  privateKey: null,
  /** @type {CryptoKey|null} */
  publicKey: null,
  /** @type {string|null} — base64 публичного ключа для отправки другим */
  publicKeyExport: null,

  /**
   * Генерирует пару RSA-4096 ключей
   * @returns {Promise<void>}
   */
  async generateKeys() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['encrypt', 'decrypt']
    );

    this.privateKey = keyPair.privateKey;
    this.publicKey = keyPair.publicKey;

    // Экспортируем публичный ключ в base64 для отправки на сервер
    const exported = await crypto.subtle.exportKey('spki', this.publicKey);
    this.publicKeyExport = btoa(String.fromCharCode(...new Uint8Array(exported)));

    return { publicKey: this.publicKeyExport };
  },

  /**
   * Импортирует публичный ключ из base64 (для шифрования сообщений получателю)
   * @param {string} base64PublicKey
   * @returns {Promise<CryptoKey>}
   */
  async importPublicKey(base64PublicKey) {
    const binaryString = atob(base64PublicKey);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    return crypto.subtle.importKey(
      'spki',
      bytes,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    );
  },

  /**
   * Импортирует приватный ключ из JWK (для расшифровки входящих сообщений)
   * @param {JsonWebKey} jwk
   * @returns {Promise<CryptoKey>}
   */
  async importPrivateKey(jwk) {
    this.privateKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    );
    return this.privateKey;
  },

  /**
   * Экспортирует приватный ключ в JWK для сохранения
   * @returns {Promise<JsonWebKey|null>}
   */
  async exportPrivateKey() {
    if (!this.privateKey) return null;
    return crypto.subtle.exportKey('jwk', this.privateKey);
  },

  /**
   * Шифрует сообщение публичным ключом получателя
   * @param {string} message — открытый текст
   * @param {CryptoKey} recipientPublicKey — публичный ключ получателя
   * @returns {Promise<string>} — JSON: { encryptedMessage, encryptedKey, iv }
   */
  async encryptMessage(message, recipientPublicKey) {
    // 1. Генерируем случайный AES-256 ключ
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // 2. Шифруем сообщение AES
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(message);
    const encryptedMessage = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encoded
    );

    // 3. Шифруем AES-ключ публичным RSA ключом получателя
    const encryptedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientPublicKey,
      await crypto.subtle.exportKey('raw', aesKey)
    );

    // 4. Возвращаем base64
    return JSON.stringify({
      encryptedMessage: btoa(String.fromCharCode(...new Uint8Array(encryptedMessage))),
      encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedKey))),
      iv: btoa(String.fromCharCode(...iv))
    });
  },

  /**
   * Расшифровывает сообщение приватным ключом
   * @param {string} encryptedJSON — JSON строка от encryptMessage
   * @returns {Promise<string>} — открытый текст
   */
  async decryptMessage(encryptedJSON) {
    if (!this.privateKey) throw new Error('Приватный ключ не загружен');

    const { encryptedMessage, encryptedKey, iv } = JSON.parse(encryptedJSON);

    // 1. Расшифровываем AES-ключ
    const encryptedKeyBytes = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
    const aesKeyRaw = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      this.privateKey,
      encryptedKeyBytes
    );

    const aesKey = await crypto.subtle.importKey(
      'raw',
      aesKeyRaw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt']
    );

    // 2. Расшифровываем сообщение
    const encryptedMsgBytes = Uint8Array.from(atob(encryptedMessage), c => c.charCodeAt(0));
    const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      encryptedMsgBytes
    );

    return new TextDecoder().decode(decrypted);
  },

  /**
   * Проверяет, является ли строка E2E-зашифрованным сообщением
   * @param {string} text
   * @returns {boolean}
   */
  isEncrypted(text) {
    try {
      const obj = JSON.parse(text);
      return !!(obj.encryptedMessage && obj.encryptedKey && obj.iv);
    } catch {
      return false;
    }
  }
};
