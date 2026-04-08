/**
 * Сообщения и мессенджер
 */

// Состояние пагинации сообщений
let messagesCursor = null;

// Кэш публичных E2E ключей: userId -> base64 publicKey
const e2ePublicKeyCache = new Map();

/**
 * Получает публичный E2E ключ пользователя (с кэшем)
 * @param {number} userId
 * @returns {Promise<CryptoKey|null>}
 */
async function getUserE2EKey(userId) {
  // Не кэшируем — всегда запрашиваем свежий ключ с сервера
  try {
    const user = await api(`/api/users/${userId}`);
    if (user.e2e_public_key) {
      return E2E.importPublicKey(user.e2e_public_key);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Шифрует сообщение E2E
 * @param {string} content
 * @param {number} receiverId
 * @returns {Promise<{content: string, type: string, fileUrl: string}>}
 */
async function encryptMessageForUser(content, receiverId) {
  const pubKey = await getUserE2EKey(receiverId);
  if (!pubKey) {
    // У получателя нет E2E ключа — отправляем как есть (fallback)
    return { content, type: 'text', fileUrl: '' };
  }
  const encrypted = await E2E.encryptMessage(content, pubKey);
  return { content: encrypted, type: 'e2e', fileUrl: '' };
}

/**
 * Расшифровывает сообщение если это E2E
 * @param {string} content
 * @param {string} type
 * @returns {Promise<string>}
 */
async function tryDecryptMessage(content, type) {
  if (type !== 'e2e' && !E2E.isEncrypted(content)) return content;
  try {
    return await E2E.decryptMessage(content);
  } catch (e) {
    console.warn('[E2E] Ошибка расшифровки:', e);
    return '🔒 [Не удалось расшифровать сообщение]';
  }
}

// ======================== СТАТУС ПОЛЬЗОВАТЕЛЯ ========================

async function updateChatStatus(userId) {
  try {
    const user = await api(`/api/users/${userId}`);
    const statusEl = $('.online-indicator');
    if (!statusEl) return;
    if (user.status === 'online') {
      statusEl.innerHTML = '<span class="online-dot"></span>Онлайн';
      statusEl.style.color = 'var(--success)';
    } else {
      statusEl.innerHTML = '<span class="online-dot offline"></span>Не в сети';
      statusEl.style.color = 'var(--text-muted)';
    }
  } catch (e) { console.error('updateChatStatus:', e); }
}

// Слушаем события смены статуса
socket.on('user_status', ({ userId, status }) => {
  // Обновляем статус в чате
  if (userId == state.chatUserId) {
    const statusEl = $('.online-indicator');
    if (!statusEl) return;
    if (status === 'online') {
      statusEl.innerHTML = '<span class="online-dot"></span>Онлайн';
      statusEl.style.color = 'var(--success)';
    } else {
      statusEl.innerHTML = '<span class="online-dot offline"></span>Не в сети';
      statusEl.style.color = 'var(--text-muted)';
    }
  }
  // Обновляем статус в карточках пользователей (Главная/Люди)
  document.querySelectorAll('.user-card-modern').forEach(card => {
    const avatarLink = card.querySelector('.user-card-avatar-link');
    if (avatarLink?.dataset.username === userId) {
      const statusEl = card.querySelector('.user-card-status');
      if (statusEl) {
        statusEl.innerHTML = status === 'online'
          ? '<span class="status-dot"></span>Онлайн'
          : '<span class="status-dot offline"></span>Не в сети';
      }
    }
  });
});

// ======================== ДИАЛОГИ ========================

async function loadConversations() {
  try {
    resetChatView();
    const convs = await api('/api/conversations');
    const c = $('#conversations-list');
    if (!convs.length) {
      c.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><p>Нет диалогов</p></div>';
      return;
    }
    c.innerHTML = convs.map(f => {
      const last = f.last_message ? (f.last_message.length > 40 ? f.last_message.substring(0, 40) + '...' : f.last_message) : 'Нет сообщений';
      const time = f.last_message_at ? parseUTC(f.last_message_at).toLocaleTimeString('ru', MOSCOW_CLOCK) : '';
      const fromMe = f.last_sender_id == userId;
      const activeClass = f.id == state.chatUserId ? ' active' : '';
      return `<div class="conversation-item-modern${activeClass}" data-chat-id="${f.id}" data-chat-name="${esc(f.display_name || f.username)}" data-chat-avatar="${esc(f.avatar || '')}" data-chat-username="${esc(f.username)}"><div class="conversation-avatar-wrapper">${avatarHTML(f, 'conversation')}</div><div class="conversation-info"><div class="conversation-item-top"><a href="/${esc(f.username)}" class="conversation-item-name post-author-link" data-username="${esc(f.username)}">${esc(f.display_name || f.username)}</a>${time ? `<div class="conversation-time">${time}</div>` : ''}</div><div class="conversation-item-bottom"><div class="last-message-text ${fromMe ? 'sent' : ''}">${fromMe ? 'Вы: ' : ''}${esc(last)}</div>${f.unread_count > 0 ? `<div class="unread-badge">${f.unread_count}</div>` : ''}</div></div></div>`;
    }).join('');
  } catch (e) { console.error('loadConversations:', e); }
}

// ======================== ОТКРЫТИЕ ЧАТА ========================

// Сброс chat-open при загрузке страницы сообщений
function resetChatView() {
  document.querySelector('.messenger-layout')?.classList.remove('chat-open');
}

window.openChat = async function(fId, fName, fAvatar, fUsername = '') {
  state.chatUserId = fId;

  // Переключаем на страницу сообщений
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  const msgLink = $('[data-page="messages"]');
  if (msgLink) msgLink.classList.add('active');

  $$('.page').forEach(p => p.classList.remove('active'));
  const msgPage = $('#messages-page');
  if (msgPage) msgPage.classList.add('active');
  history.pushState({ page: 'messages' }, '', '/messages');

  // Показываем чат
  const chatEmpty = $('#chat-empty');
  const chatActive = $('#chat-active');
  if (chatEmpty) chatEmpty.style.display = 'none';
  if (chatActive) chatActive.style.display = 'flex';

  // Мобильный: переключаем на экран чата
  const isMobile = window.innerWidth <= 768;
  const messengerLayout = document.querySelector('.messenger-layout');
  if (messengerLayout) {
    if (isMobile) {
      messengerLayout.classList.add('chat-open');
    } else {
      messengerLayout.classList.remove('chat-open');
    }
  }

  const el = $('#chat-username');
  if (fUsername) el.innerHTML = `<a href="/${esc(fUsername)}" class="chat-user-link post-author-link" data-username="${esc(fUsername)}">${esc(fName)}</a>`;
  else el.textContent = fName;

  // Обновляем статус
  updateChatStatus(fId);

  if (fAvatar) {
    $('#chat-avatar').src = fAvatar; $('#chat-avatar').style.display = 'block'; $('#chat-avatar-placeholder').style.display = 'none';
  } else {
    $('#chat-avatar').style.display = 'none'; $('#chat-avatar-placeholder').style.display = 'flex';
  }

  await loadConversations();
  $$('.conversation-item-modern').forEach(i => { i.classList.toggle('active', i.dataset.chatId == fId); });
  messagesCursor = null; // сброс курсора при открытии нового чата
  await loadMessages(fId);
  // После загрузки сообщений сервер уже пометил их прочитанными — обновляем счётчик
  setTimeout(async () => {
    await loadMessagesCount();
    await loadConversations();
  }, 300);
}

// ======================== СООБЩЕНИЯ ========================

async function loadMessages(fid, prepend = false) {
  try {
    const url = messagesCursor
      ? `/api/messages/${fid}?cursor=${messagesCursor}`
      : `/api/messages/${fid}`;
    const data = await api(url);
    const msgs = data.messages || [];
    messagesCursor = data.nextCursor || null;

    const c = $('#chat-messages');

    if (!prepend) {
      c.innerHTML = '';
      if (msgs.length === 0) {
        c.innerHTML = '<div class="empty-state"><p>Нет сообщений</p></div>';
        return;
      }
      // E2E расшифровка — ждём все promises
      const bubbles = await Promise.all(msgs.map(renderMessageBubble));
      c.innerHTML = bubbles.join('');
    } else {
      if (msgs.length === 0) {
        const loadMoreBtn = c.querySelector('.load-more-messages');
        if (loadMoreBtn) loadMoreBtn.remove();
        return;
      }
      const bubbles = await Promise.all(msgs.map(renderMessageBubble));
      c.insertAdjacentHTML('afterbegin', bubbles.join(''));

      // Удаляем кнопку "загрузить ещё" если её не нужно показывать
      if (!data.hasMore) {
        const loadMoreBtn = c.querySelector('.load-more-messages');
        if (loadMoreBtn) loadMoreBtn.remove();
      }
    }

    // Добавляем кнопку "загрузить ещё" если есть старые сообщения
    if (data.hasMore && !prepend) {
      c.insertAdjacentHTML('afterbegin', '<div class="load-more-wrap"><button class="load-more-messages" data-fid="' + fid + '">Загрузить старые сообщения</button></div>');
    }

    // Скролл вниз
    c.scrollTop = c.scrollHeight;

    // Init audio для новых элементов
    c.querySelectorAll('.audio-player').forEach(player => initAudioDuration(player));
  } catch (e) { console.error('[messages] loadMessages:', e); }
}

/**
 * Рендерит одно сообщение в bubble и добавляет в DOM
 * @param {Object} m — сообщение
 * @param {string} cls — CSS класс ('sent' или 'received')
 */
async function appendMessageBubble(m, cls) {
  const html = await renderMessageBubble(m);
  const c = $('#chat-messages');
  if (!c) return;
  const div = document.createElement('div');
  div.className = `message-bubble ${cls}`;
  div.innerHTML = html;
  c.appendChild(div);
  const player = div.querySelector('.audio-player');
  if (player) initAudioDuration(player);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/**
 * Рендерит HTML одного сообщения (bubble)
 */
window.renderMessageBubble = async function(m) {
  const isSent = m.sender_id == userId;
  const t = parseUTC(m.created_at).toLocaleTimeString('ru', MOSCOW_CLOCK);
  const safeUrl = sanitizeUrl(m.file_url);

  // E2E расшифровка
  let displayContent = m.content;
  if (m.type === 'e2e') {
    displayContent = await tryDecryptMessage(m.content, m.type);
  }

  let fileHTML = '';
  if (m.file_url) {
    // Извлекаем оригинальное имя файла
    let fileName = '';
    if (m.file_name) fileName = m.file_name;
    else if (m.content && !E2E.isEncrypted(m.content) && m.content.length < 100) fileName = m.content;
    else if (m.file_url) fileName = m.file_url.split('/').pop().replace(/^[a-f0-9-]+\./, '');

    const safeUrl = sanitizeUrl(m.file_url);
    if (m.type === 'image') {
      fileHTML = `<div class="msg-file"><img src="${safeUrl}" class="msg-image" data-action="view-media" data-url="${m.file_url}" data-type="image">${fileName ? `<div class="msg-file-name">${esc(fileName)}</div>` : ''}</div>`;
    } else if (m.type === 'audio') {
      let audioName = fileName;
      if (!audioName && m.file_url) audioName = m.file_url.split('/').pop().replace(/^[a-f0-9-]+-/, '').replace(/\.[^.]+$/, '');
      fileHTML = `<div class="msg-file"><div class="audio-player" data-src="${safeUrl}" data-name="${esc(audioName)}"><div class="audio-play-btn" data-action="toggle-audio"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div><div class="audio-info"><div class="audio-name">${esc(audioName)}</div><div class="audio-controls"><div class="audio-progress-wrap" data-action="seek-audio"><div class="audio-progress-bar"><div class="audio-progress-fill" style="width:0%"></div></div></div><div class="audio-time"><span class="cur">0:00</span><span class="tot"></span></div></div></div><audio src="${safeUrl}" preload="metadata"></audio></div></div>`;
    } else if (m.type === 'video') {
      fileHTML = `<div class="msg-file"><video controls class="msg-video" src="${safeUrl}"></video></div>`;
    } else if (m.type === 'file') {
      const displayName = fileName || 'Файл';
      fileHTML = `<div class="msg-file"><a href="${safeUrl}" class="msg-file-link" download>📎 ${esc(displayName)}</a></div>`;
    } else {
      // Комбинированное сообщение: текст + файл (тип 'text' но есть file_url)
      // Определяем тип файла по расширению
      const ext = (m.file_url.split('.').pop() || '').toLowerCase();
      if (/\.(jpg|jpeg|png|gif|webp)$/.test(ext)) {
        fileHTML = `<div class="msg-file"><img src="${safeUrl}" class="msg-image" data-action="view-media" data-url="${m.file_url}" data-type="image">${fileName ? `<div class="msg-file-name">${esc(fileName)}</div>` : ''}</div>`;
      } else if (/\.(mp3|wav|ogg|flac|m4a|aac)$/.test(ext)) {
        let audioName = fileName || m.file_url.split('/').pop().replace(/\.[^.]+$/, '');
        fileHTML = `<div class="msg-file"><div class="audio-player" data-src="${safeUrl}" data-name="${esc(audioName)}"><div class="audio-play-btn" data-action="toggle-audio"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div><div class="audio-info"><div class="audio-name">${esc(audioName)}</div><div class="audio-controls"><div class="audio-progress-wrap" data-action="seek-audio"><div class="audio-progress-bar"><div class="audio-progress-fill" style="width:0%"></div></div></div><div class="audio-time"><span class="cur">0:00</span><span class="tot"></span></div></div></div><audio src="${safeUrl}" preload="metadata"></audio></div></div>`;
      } else if (/\.(mp4|webm|mkv|avi)$/.test(ext)) {
        fileHTML = `<div class="msg-file"><video controls class="msg-video" src="${safeUrl}"></video></div>`;
      } else {
        const displayName = fileName || 'Файл';
        fileHTML = `<div class="msg-file"><a href="${safeUrl}" class="msg-file-link" download>📎 ${esc(displayName)}</a></div>`;
      }
    }
  }

  // Текст показываем даже если есть файл (комбинированное сообщение)
  const hasText = m.type === 'text' || (m.type === 'e2e' && displayContent && !E2E.isEncrypted(displayContent));
  const text = hasText ? `<div class="msg-text-content">${esc(displayContent)}</div>` : '';

  return `<div class="message-bubble ${isSent ? 'sent' : 'received'}">${text}${fileHTML}<div class="message-time">${t}</div></div>`;
};

/**
 * Загружает старые сообщения (курсорная пагинация)
 */
window.loadOlderMessages = async function(fid) {
  if (!messagesCursor) return;
  const c = $('#chat-messages');
  const btn = c.querySelector('.load-more-messages');
  if (btn) {
    btn.textContent = 'Загрузка...';
    btn.disabled = true;
  }
  await loadMessages(fid, true);
}

// ======================== МЕДИА ========================

// Audio Player
window.initAudioDuration = function(player) {
  const audio = player?.querySelector('audio');
  const totEl = player?.querySelector('.tot');
  if (!audio || !totEl) return;
  if (audio.duration && !isNaN(audio.duration) && !totEl.textContent) {
    const m = Math.floor(audio.duration / 60), s = Math.floor(audio.duration % 60);
    totEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    return;
  }
  const handler = () => {
    if (audio.duration && !isNaN(audio.duration) && !totEl.textContent) {
      const m = Math.floor(audio.duration / 60), s = Math.floor(audio.duration % 60);
      totEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      audio.removeEventListener('loadedmetadata', handler);
    }
  };
  audio.addEventListener('loadedmetadata', handler);
  audio.addEventListener('durationchange', handler);
  audio.load();
};

window.toggleAudio = function(btn) {
  const player = btn.closest('.audio-player');
  const audio = player?.querySelector('audio');
  const fill = player?.querySelector('.audio-progress-fill');
  const curEl = player?.querySelector('.cur');
  if (!audio || !fill || !curEl) return;

  if (audio.duration && !isNaN(audio.duration) && !player.querySelector('.tot').textContent) {
    const m = Math.floor(audio.duration / 60), s = Math.floor(audio.duration % 60);
    player.querySelector('.tot').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  if (audio.paused) {
    document.querySelectorAll('.audio-player audio').forEach(a => {
      if (a !== audio) { a.pause(); a.closest('.audio-player').querySelector('.audio-play-btn svg').innerHTML = '<path d="M8 5v14l11-7z"/>'; }
    });
    audio.play();
    btn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    const update = () => {
      if (audio.paused || audio.ended) {
        btn.querySelector('svg').innerHTML = '<path d="M8 5v14l11-7z"/>';
        fill.style.width = '0%'; curEl.textContent = '0:00'; return;
      }
      fill.style.width = (audio.currentTime / audio.duration) * 100 + '%';
      const m = Math.floor(audio.currentTime / 60), s = Math.floor(audio.currentTime % 60);
      curEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  } else {
    audio.pause();
    btn.querySelector('svg').innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
};

window.seekAudio = function(e, wrap) {
  const audio = wrap.closest('.audio-player')?.querySelector('audio');
  if (!audio?.duration || isNaN(audio.duration)) return;
  const rect = wrap.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration;
};

// Media Viewer
window.openMediaViewer = function(url, type) {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return;

  let viewer = $('#media-viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'media-viewer'; viewer.className = 'media-viewer';
    viewer.innerHTML = '<div class="media-viewer-overlay" data-action="close-media-viewer"></div><div class="media-viewer-content"><button class="media-viewer-close" data-action="close-media-viewer">✕</button><div class="media-viewer-body"></div></div>';
    document.body.appendChild(viewer);
  }

  const body = viewer.querySelector('.media-viewer-body');
  if (type === 'image') {
    body.innerHTML = `<div class="img-zoom-wrap"><img src="${safeUrl}" class="media-viewer-img" draggable="false"></div>`;
    const wrap = body.querySelector('.img-zoom-wrap');
    const img = body.querySelector('.media-viewer-img');
    let scale = 1, tx = 0, ty = 0;
    let isDragging = false, dragStartX, dragStartY, startTx, startTy;

    const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; img.style.cursor = scale > 1 ? 'grab' : 'default'; };

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const newScale = Math.max(1, Math.min(5, scale - e.deltaY * 0.002));
      if (newScale === scale) return;
      const ratio = newScale / scale;
      tx = mx - (mx - tx) * ratio;
      ty = my - (my - ty) * ratio;
      scale = newScale;
      // Центрируем при зуме 1
      if (scale <= 1) { scale = 1; tx = 0; ty = 0; }
      img.style.transition = 'transform 0.15s ease';
      apply();
    }, { passive: false });

    wrap.addEventListener('mousedown', e => {
      if (scale <= 1 || e.button !== 0) return;
      isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY; startTx = tx; startTy = ty;
      img.style.cursor = 'grabbing'; img.style.transition = 'none'; e.preventDefault();
    });
    window.addEventListener('mousemove', e => { if (!isDragging) return; tx = startTx + (e.clientX - dragStartX); ty = startTy + (e.clientY - dragStartY); apply(); });
    window.addEventListener('mouseup', () => { if (!isDragging) return; isDragging = false; img.style.cursor = 'grab'; img.style.transition = 'transform 0.15s ease'; });
  } else if (type === 'video') {
    body.innerHTML = `<video controls autoplay class="media-viewer-video" src="${safeUrl}"></video>`;
  } else {
    body.innerHTML = `<div class="media-viewer-audio-wrap"><audio controls autoplay src="${safeUrl}"></audio></div>`;
  }
  viewer.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeMediaViewer = function() {
  const v = $('#media-viewer');
  if (v) { v.style.display = 'none'; const b = v.querySelector('.media-viewer-body'); if (b) b.innerHTML = ''; }
  document.body.style.overflow = '';
};

// Закрытие по клику на фон вьюера
document.addEventListener('click', e => {
  const viewer = document.getElementById('media-viewer');
  if (!viewer || viewer.style.display === 'none') return;
  // Закрываем если клик НЕ по содержимому (картинка/видео/аудио) и НЕ по кнопке закрытия
  const body = viewer.querySelector('.media-viewer-body');
  const closeBtn = viewer.querySelector('.media-viewer-close');
  if ((body && !body.contains(e.target)) && !(closeBtn && closeBtn.contains(e.target))) {
    closeMediaViewer();
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMediaViewer(); });

// ======================== ЗАГРУЗКА ФАЙЛОВ ========================

// Переменная для хранения файла перед отправкой
let pendingMessageFile = null;

window.sendMessageFile = async function(file, receiverId) {
  if (!file || !receiverId) return;
  const fd = new FormData(); fd.append('file', file);
  try {
    const up = await api('/api/messages/upload', { method: 'POST', body: fd });
    socket.emit('send_message', { receiverId, content: up.fileName, type: up.type, fileUrl: up.fileUrl });
  } catch (e) { notify('Ошибка загрузки: ' + e.message, 'error'); }
};

// Отправка файлов из drag&drop вместе с текстом
window.sendDroppedFiles = async function() {
  const files = window._droppedFiles || [];
  if (!files.length || !state.chatUserId) { cancelDropPreview(); return; }

  const input = $('#message-input');
  const textContent = input?.value.trim() || '';

  // Загружаем первый файл (если несколько — отправляем по одному)
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isFirst = i === 0;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const up = await api('/api/messages/upload', { method: 'POST', body: fd });
      // Для первого файла добавляем текст
      let content = up.fileName;
      let type = up.type;
      if (isFirst && textContent) {
        const encrypted = await encryptMessageForUser(textContent, state.chatUserId);
        content = encrypted.content;
        type = 'text'; // тип будет 'text', но файл тоже есть
      }
      socket.emit('send_message', {
        receiverId: state.chatUserId,
        content,
        type: isFirst && textContent ? 'text' : type,
        fileUrl: up.fileUrl,
        fileName: up.fileName
      });
    } catch (e) { notify('Ошибка загрузки: ' + e.message, 'error'); }
  }
  if (input) input.value = '';
  cancelDropPreview();
};

// Drop zone
window.setupDropZone = function() {
  const chat = $('#chat-active');
  if (!chat) return;

  ['dragenter', 'dragover'].forEach(evt => { chat.addEventListener(evt, e => { e.preventDefault(); chat.classList.add('drag-over'); }); });
  ['dragleave', 'drop'].forEach(evt => { chat.addEventListener(evt, e => { e.preventDefault(); chat.classList.remove('drag-over'); }); });
  chat.addEventListener('drop', e => {
    e.preventDefault();
    if (!state.chatUserId) return;
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type.startsWith('video/'));
    if (files.length) showDropPreview(files);
  });
};

window.showDropPreview = function(files) {
  let existing = $('#drop-preview'); if (existing) existing.remove();
  const preview = document.createElement('div');
  preview.id = 'drop-preview';
  preview.innerHTML = files.map(f => {
    const icon = f.type.startsWith('image/') ? '🖼️' : f.type.startsWith('audio/') ? '🎵' : '🎬';
    return `<div class="drop-file-item"><span class="drop-file-icon">${icon}</span><span class="drop-file-name">${esc(f.name)}</span><span class="drop-file-size">${(f.size / 1024).toFixed(1)} KB</span></div>`;
  }).join('') + `<div class="drop-actions"><button class="btn-drop-send" data-action="send-dropped-files">Отправить</button><button class="btn-drop-cancel" data-action="cancel-drop-preview">Отмена</button></div>`;
  window._droppedFiles = files;
  $('#chat-messages')?.after(preview);
};

window.sendDroppedFiles = async function() {
  const files = window._droppedFiles || [];
  if (state.chatUserId) for (const file of files) sendMessageFile(file, state.chatUserId);
  cancelDropPreview();
};

window.cancelDropPreview = function() {
  const p = $('#drop-preview'); if (p) p.remove(); window._droppedFiles = null;
};

// File input — сохраняем файл, но не отправляем сразу
$('#message-file-input')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file && state.chatUserId) {
    pendingMessageFile = file;
    // Показываем превью
    const preview = $('#file-preview');
    if (preview) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          preview.innerHTML = `<img src="${reader.result}" style="max-width:200px;max-height:120px;border-radius:8px;">
            <button type="button" class="file-preview-remove" data-action="remove-file-preview">✕</button>`;
        };
        reader.readAsDataURL(file);
      } else {
        preview.innerHTML = `📎 ${esc(file.name)} <button type="button" class="file-preview-remove" data-action="remove-file-preview">✕</button>`;
      }
      preview.style.display = 'block';
    }
  }
  e.target.value = '';
});

// Удаление превью файла
document.addEventListener('click', e => {
  if (e.target.closest('[data-action="remove-file-preview"]')) {
    pendingMessageFile = null;
    const preview = $('#file-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  }
});

// Send message — Enter отправляет, Ctrl+Enter переносит строку
$('#message-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#message-input'), content = input.value.trim();
  if (!content && !pendingMessageFile) return;
  if (!state.chatUserId) return;

  if (pendingMessageFile) {
    // Отправляем файл + текст вместе как одно сообщение
    const fd = new FormData();
    fd.append('file', pendingMessageFile);
    try {
      const up = await api('/api/messages/upload', { method: 'POST', body: fd });
      // Шифруем текст если есть
      let encryptedContent = '';
      if (content) {
        const enc = await encryptMessageForUser(content, state.chatUserId);
        encryptedContent = enc.content;
      }
      socket.emit('send_message', {
        receiverId: state.chatUserId,
        content: content ? encryptedContent : up.fileName,
        type: content ? (encryptedContent ? 'e2e' : 'text') : up.type,
        fileUrl: up.fileUrl,
        fileName: up.fileName
      });
    } catch (e) { notify('Ошибка загрузки: ' + e.message, 'error'); return; }
    pendingMessageFile = null;
    const preview = $('#file-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  } else if (content) {
    // Только текст
    const encrypted = await encryptMessageForUser(content, state.chatUserId);
    socket.emit('send_message', { receiverId: state.chatUserId, content: encrypted.content, type: encrypted.type });
  }

  input.value = '';
  input.style.height = 'auto';
});

$('#message-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    $('#message-form').requestSubmit();
  }
  // Ctrl+Enter — перенос строки (ничего не делаем, стандартное поведение textarea)
});

// Статус «печатает...»
let typingTimeout;
$('#message-input')?.addEventListener('input', () => {
  if (!state.chatUserId) return;
  socket.emit('typing', { toUserId: state.chatUserId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stop_typing', { toUserId: state.chatUserId });
  }, 2000);
});

// Приём статуса «печатает...»
socket.on('user_typing', data => {
  if (data.fromUserId != state.chatUserId) return;
  const statusEl = $('#chat-status');
  if (statusEl) {
    statusEl.innerHTML = '<span class="online-dot" style="background:#f59e0b"></span> Печатает...';
  }
});

socket.on('user_stop_typing', data => {
  if (data.fromUserId != state.chatUserId) return;
  updateChatStatus(state.chatUserId);
});

// Socket events
socket.on('new_message', async msg => {
  if (msg.sender_id == state.chatUserId) {
    await appendMessageBubble(msg, 'received');
  }
  loadConversations(); loadMessagesCount();
});

socket.on('message_sent', async msg => {
  await appendMessageBubble(msg, 'sent');
  loadConversations(); loadMessagesCount();
});

// Если собеседник удалил переписку
socket.on('chat_deleted', async data => {
  if (state.chatUserId === data.userId) {
    state.chatUserId = null;
    $('#chat-active').style.display = 'none';
    $('#chat-empty').style.display = 'flex';
    document.querySelector('.messenger-layout')?.classList.remove('chat-open');
    notify('Собеседник удалил переписку', 'info');
  }
  await loadConversations();
});

async function loadMessagesCount() {
  try {
    const convs = await api('/api/conversations');
    const total = convs.reduce((s, c) => s + (c.unread_count || 0), 0);
    const badge = $('#messages-count');
    if (total > 0) { badge.textContent = total; badge.style.display = 'inline'; }
    else { badge.style.display = 'none'; }
  } catch (e) { console.error('loadMessagesCount:', e); }
}

// Delete chat
window.confirmDeleteChat = async function() {
  if (!state.chatUserId) return notify('Откройте диалог', 'error');
  if (!confirm('Удалить всю переписку? Это действие нельзя отменить.')) return;
  try {
    const deletedUserId = state.chatUserId;
    await api(`/api/messages/${state.chatUserId}`, { method: 'DELETE' });
    state.chatUserId = null;
    $('#chat-active').style.display = 'none';
    $('#chat-empty').style.display = 'flex';
    document.querySelector('.messenger-layout')?.classList.remove('chat-open');
    await loadConversations();
    // Уведомляем другого пользователя что переписка удалена
    socket.emit('chat_deleted', { userId: deletedUserId });
    notify('Переписка удалена');
  } catch (e) { notify('Ошибка: ' + e.message, 'error'); }
};

// Init drop zone
setupDropZone();

// Делегирование для медиа-элементов (вместо inline onclick)
document.addEventListener('click', e => {
  // Закрытие медиа-вьюера
  if (e.target.closest('[data-action="close-media-viewer"]')) {
    closeMediaViewer();
    return;
  }

  // Просмотр медиа
  const mediaImg = e.target.closest('[data-action="view-media"]');
  if (mediaImg) {
    e.preventDefault();
    openMediaViewer(mediaImg.dataset.url, mediaImg.dataset.type);
    return;
  }

  // Play/pause аудио
  const audioBtn = e.target.closest('[data-action="toggle-audio"]');
  if (audioBtn) {
    e.preventDefault();
    const player = audioBtn.closest('.audio-player');
    const audio = player?.querySelector('audio');
    const fill = player?.querySelector('.audio-progress-fill');
    const curEl = player?.querySelector('.cur');
    if (!audio || !fill || !curEl) return;

    if (audio.duration && !isNaN(audio.duration) && !player.querySelector('.tot').textContent) {
      const m = Math.floor(audio.duration / 60), s = Math.floor(audio.duration % 60);
      player.querySelector('.tot').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }

    if (audio.paused) {
      document.querySelectorAll('.audio-player audio').forEach(a => {
        if (a !== audio) { a.pause(); a.closest('.audio-player').querySelector('.audio-play-btn svg').innerHTML = '<path d="M8 5v14l11-7z"/>'; }
      });
      audio.play();
      audioBtn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      const update = () => {
        if (audio.paused || audio.ended) {
          audioBtn.querySelector('svg').innerHTML = '<path d="M8 5v14l11-7z"/>';
          fill.style.width = '0%'; curEl.textContent = '0:00'; return;
        }
        fill.style.width = (audio.currentTime / audio.duration) * 100 + '%';
        const m = Math.floor(audio.currentTime / 60), s = Math.floor(audio.currentTime % 60);
        curEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        requestAnimationFrame(update);
      };
      requestAnimationFrame(update);
    } else {
      audio.pause();
      audioBtn.querySelector('svg').innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
    return;
  }

  // Перемотка аудио
  const seekWrap = e.target.closest('[data-action="seek-audio"]');
  if (seekWrap) {
    e.preventDefault();
    const audio = seekWrap.closest('.audio-player')?.querySelector('audio');
    if (!audio?.duration || isNaN(audio.duration)) return;
    const rect = seekWrap.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration;
    return;
  }

  // Отправка dropped файлов
  if (e.target.closest('[data-action="send-dropped-files"]')) {
    e.preventDefault();
    if (typeof sendDroppedFiles === 'function') sendDroppedFiles();
    return;
  }

  // Отмена dropped файлов
  if (e.target.closest('[data-action="cancel-drop-preview"]')) {
    e.preventDefault();
    if (typeof cancelDropPreview === 'function') cancelDropPreview();
    return;
  }

  // Загрузить старые сообщения
  const loadMoreBtn = e.target.closest('.load-more-messages');
  if (loadMoreBtn) {
    e.preventDefault();
    loadOlderMessages(parseInt(loadMoreBtn.dataset.fid));
  }
});
