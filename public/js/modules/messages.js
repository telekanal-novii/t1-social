/**
 * Мессенджер — современный UI
 */
let messagesCursor = null;
let pendingFiles = [];
let socketAttached = false;
let replyTo = null;
let editingMsgId = null;

// ===== E2E =====
async function getPubKey(uid) {
  try {
    const u = await api(`/api/users/${uid}`);
    return u.e2e_public_key ? E2E.importPublicKey(u.e2e_public_key) : null;
  } catch { return null; }
}

async function encryptMsg(text, uid) {
  if (uid == window.currentUserId) return { content: text, type: 'text' };
  const key = await getPubKey(uid);
  if (!key) return { content: text, type: 'text' };
  return { content: await E2E.encryptMessage(text, key), type: 'e2e' };
}

async function decryptMsg(content, type) {
  if (type !== 'e2e' || !E2E.isEncrypted(content)) return content;
  try { return await E2E.decryptMessage(content); }
  catch { return '[Ошибка расшифровки]'; }
}

// ===== УТИЛИТЫ =====
function timeStr(d) {
  const dt = new Date(d);
  const t = `${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
  return t;
}

function dateGroup(d) {
  const dt = new Date(d);
  const now = new Date();
  const diff = now - dt;
  if (diff < 86400000 && dt.getDate() === now.getDate()) return 'Сегодня';
  const yes = new Date(now); yes.setDate(yes.getDate()-1);
  if (dt.getDate() === yes.getDate() && dt.getMonth() === yes.getMonth()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

// ===== SOCKET =====
function attachSocket() {
  if (socketAttached) return;
  socketAttached = true;
  
  socket.on('user_status', ({userId, status}) => {
    if (userId == state.chatUserId) updateStatus(userId);
  });
  socket.on('new_message', async msg => {
    // Обновляем счётчик всегда, когда сообщение НЕ от текущего открытого чата
    if (msg.sender_id != state.chatUserId) {
      loadMessagesCount();
    }
    // Обновляем UI сообщений только если открыт чат с отправителем
    if (msg.sender_id == state.chatUserId) {
      const c = $('#chat-messages');
      c?.querySelector('.empty-state')?.remove();
      c.insertAdjacentHTML('beforeend', await bubble(msg));
      c.scrollTop = c.scrollHeight;
    }
    loadConversations();
  });
  socket.on('message_sent', async msg => {
    // Обновляем UI только если открыт чат с получателем
    if (msg.receiver_id == state.chatUserId) {
      const c = $('#chat-messages');
      c?.querySelector('.empty-state')?.remove();
      c.insertAdjacentHTML('beforeend', await bubble(msg));
      c.scrollTop = c.scrollHeight;
    }
    loadConversations();
  });
  socket.on('chat_deleted', data => {
    if (state.chatUserId === data.userId) {
      state.chatUserId = null;
      $('#chat-active').style.display = 'none';
      $('#chat-empty').style.display = 'flex';
      notify('Переписка удалена', 'info');
    }
    loadConversations();
  });
  socket.on('user_typing', d => {
    if (d.fromUserId != state.chatUserId) return;
    const el = $('#chat-status');
    if (el) el.innerHTML = '<span class="online-dot" style="background:#f59e0b"></span> Печатает...';
  });
  socket.on('user_stop_typing', d => {
    if (d.fromUserId != state.chatUserId) return;
    updateStatus(state.chatUserId);
  });
}

// ===== ДИАЛОГИ =====
window.loadConversations = async function() {
  const c = $('#conversations-list');
  if (!c) return;
  try {
    const convs = await api('/api/conversations');
    if (!convs.length) {
      c.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><p>Нет диалогов</p></div>`;
      return;
    }
    c.innerHTML = convs.map(f => {
      const last = f.last_message ? (f.last_message.length>50?f.last_message.substring(0,50)+'...':f.last_message) : 'Нет сообщений';
      const fromMe = f.last_sender == userId;
      return `<div class="conv-item${f.id==state.chatUserId?' active':''}" data-chat-id="${f.id}" data-chat-name="${esc(f.display_name||f.username)}" data-chat-avatar="${esc(f.avatar||'')}" data-chat-username="${esc(f.username)}">
        <a href="/${esc(f.username)}" class="conv-avatar">${avatarHTML(f,'conversation')}</a>
        <div class="conv-info">
          <div class="conv-top">
            <a href="/${esc(f.username)}" class="conv-name">${esc(f.display_name||f.username)}</a>
            ${f.unread_count>0?`<div class="conv-badge">${f.unread_count}</div>`:''}
          </div>
          <div class="conv-bottom">
            <div class="conv-last ${fromMe?'sent':''}">${fromMe?'Вы: ':''}${esc(last)}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
};

// ===== ОТКРЫТИЕ ЧАТА =====
window.openChat = async function(id, name, avatar, username) {
  state.chatUserId = id;
  attachSocket();

  $$('.nav-link').forEach(l => l.classList.remove('active'));
  $('[data-page="messages"]')?.classList.add('active');
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#messages-page')?.classList.add('active');
  history.pushState({page:'messages'}, '', '/messages');

  $('#chat-empty').style.display = 'none';
  $('#chat-active').style.display = 'flex';
  document.querySelector('.messenger-layout')?.classList.toggle('chat-open', window.innerWidth<=768);

  const el = $('#chat-username');
  if (username) el.innerHTML = `<a href="/${esc(username)}" class="chat-user-link">${esc(name)}</a>`;
  else el.textContent = name;

  if (avatar) {
    $('#chat-avatar').src = avatar; $('#chat-avatar').style.display = 'block';
    $('#chat-avatar-placeholder').style.display = 'none';
  } else {
    $('#chat-avatar').style.display = 'none';
    $('#chat-avatar-placeholder').style.display = 'flex';
  }

  updateStatus(id);
  await loadConversations();
  messagesCursor = null;
  await loadMessages(id);
  setTimeout(() => { markRead(id); loadMessagesCount(); }, 300);
};

async function updateStatus(uid) {
  try {
    const u = await api(`/api/users/${uid}`);
    const el = $('#chat-status');
    if (!el) return;
    if (u.status==='online') { el.innerHTML='<span class="online-dot"></span>Онлайн'; el.style.color='var(--success)'; }
    else { el.innerHTML='<span class="online-dot offline"></span>Не в сети'; el.style.color='var(--text-muted)'; }
  } catch {}
}

async function markRead(uid) { try { await api(`/api/messages/read/${uid}`, {method:'PUT'}); } catch {} }

// ===== СООБЩЕНИЯ =====
window.loadMessages = async function(fid, prepend=false) {
  try {
    const url = messagesCursor ? `/api/messages/${fid}?cursor=${messagesCursor}` : `/api/messages/${fid}`;
    const data = await api(url);
    const msgs = data.messages || [];
    messagesCursor = data.nextCursor || null;
    const c = $('#chat-messages');
    if (!c) return;

    if (!prepend) {
      c.innerHTML = '';
      if (!msgs.length) { c.innerHTML = '<div class="empty-state"><p>Нет сообщений</p></div>'; return; }
      
      // Группировка по дате
      let lastDate = '';
      for (const m of msgs) {
        const dg = dateGroup(m.created_at);
        if (dg !== lastDate) {
          c.insertAdjacentHTML('beforeend', `<div class="date-divider">${dg}</div>`);
          lastDate = dg;
        }
        c.insertAdjacentHTML('beforeend', await bubble(m));
      }
    } else {
      if (!msgs.length) { c.querySelector('.load-more')?.remove(); return; }
      const oldH = c.scrollHeight;
      let lastDate = '';
      for (const m of [...msgs].reverse()) {
        const dg = dateGroup(m.created_at);
        if (dg !== lastDate) {
          c.insertAdjacentHTML('afterbegin', `<div class="date-divider">${dg}</div>`);
          lastDate = dg;
        }
        c.insertAdjacentHTML('afterbegin', await bubble(m));
      }
      c.scrollTop = c.scrollHeight - oldH;
      if (!data.hasMore) c.querySelector('.load-more')?.remove();
    }
    if (data.hasMore && !prepend) c.insertAdjacentHTML('afterbegin', `<div class="load-more-wrap"><button class="load-more" data-fid="${fid}">Загрузить старые</button></div>`);
    if (!prepend) c.scrollTop = c.scrollHeight;
    c.querySelectorAll('.msg-audio-player').forEach(initAudio);
    c.querySelectorAll('.msg-video-wrap').forEach(initVideo);
  } catch(e) { console.error(e); }
};

async function bubble(m) {
  const sent = m.sender_id == userId;
  let text = m.is_deleted ? '<em>Сообщение удалено</em>' : await decryptMsg(m.content, m.type);
  let media = '';
  
  if (m.file_url && !m.is_deleted) {
    const ext = m.file_url.split('.').pop().toLowerCase();
    const name = m.file_name || m.file_url.split('/').pop();
    if (m.type==='image' || /\.(jpg|jpeg|png|gif|webp)$/.test(ext)) {
      media = `<div class="msg-media"><img src="${esc(m.thumb_url||m.file_url)}" data-action="view-media" data-url="${esc(m.file_url)}" data-type="image" loading="lazy"></div>`;
    } else if (m.type==='audio' || /\.(mp3|wav|ogg)$/.test(ext)) {
      const audioId = `msg-audio-${m.id}`;
      media = `<div class="msg-media"><div class="msg-audio-player" id="${audioId}" data-src="${esc(m.file_url)}">
        <div class="msg-audio-top">
          <button class="msg-audio-play-btn" title="Воспроизвести">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" class="msg-audio-icon-play">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" class="msg-audio-icon-pause" style="display:none">
              <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
          </button>
          <div class="msg-audio-info">
            <div class="msg-audio-name">${esc(name.replace(/\.[^.]+$/,''))}</div>
            <div class="msg-audio-progress-wrap">
              <div class="msg-audio-progress" data-action="seek-audio">
                <div class="msg-audio-bar"><div class="msg-audio-fill"></div></div>
                <div class="msg-audio-thumb"></div>
              </div>
            </div>
          </div>
          <div class="msg-audio-right">
            <span class="msg-audio-time"><span class="cur">0:00</span><span class="sep">/</span><span class="tot"></span></span>
            <button class="msg-audio-speed-btn" data-speed="1" title="Скорость воспроизведения">1x</button>
          </div>
        </div>
        <audio src="${esc(m.file_url)}" preload="metadata"></audio>
      </div></div>`;
    } else if (m.type==='video' || /\.(mp4|webm)$/.test(ext)) {
      media = `<div class="msg-media msg-video-wrap">
        <video src="${esc(m.file_url)}" class="msg-video" preload="metadata" playsinline></video>
        <button class="msg-video-close-btn" title="Закрыть видео" data-action="close-video">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="msg-video-controls">
          <button class="msg-video-play-btn" title="Воспроизвести">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="msg-video-progress">
            <div class="msg-video-bar"></div>
          </div>
          <span class="msg-video-time">0:00 / 0:00</span>
          <button class="msg-video-mute-btn" title="Звук">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
          <button class="msg-video-full-btn" title="Полный экран">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          </button>
        </div>
        <div class="msg-video-overlay"></div>
      </div>`;
    } else {
      media = `<div class="msg-media"><a href="${esc(m.file_url)}" class="msg-file-link" download>📎 ${esc(name)}</a></div>`;
    }
  }

  // Reply
  let replyHTML = '';
  if (m.reply_to && m.reply_content) {
    replyHTML = `<div class="msg-reply"><span>↪ Ответ</span> ${esc(m.reply_content.substring(0,80))}${m.reply_content.length>80?'...':''}</div>`;
  }

  const editMark = m.edited_at ? ' (ред.)' : '';
  const txt = text ? `<div class="msg-text">${esc(text)}${editMark}</div>` : '';
  const status = sent && !m.is_deleted ? `<span class="msg-status">${m.is_read?'✓✓':'✓'}</span>` : '';

  // Контекстное меню
  const ctxMenu = sent && !m.is_deleted ? `<div class="msg-actions">
    <button class="msg-action-btn" data-action="reply" data-msg-id="${m.id}" title="Ответить">↩️</button>
    <button class="msg-action-btn" data-action="edit" data-msg-id="${m.id}" title="Редактировать">✏️</button>
    <button class="msg-action-btn" data-action="delete" data-msg-id="${m.id}" title="Удалить">🗑️</button>
  </div>` : '';

  return `<div class="msg ${sent?'sent':'recv'}" data-msg-id="${m.id}" data-msg-type="${m.type}">${replyHTML}${txt}${media}<div class="msg-meta"><span>${timeStr(m.created_at)}</span>${status}</div>${ctxMenu}</div>`;
}

window.loadOlderMessages = async function(fid) {
  const btn = $('#chat-messages .load-more');
  if (btn) { btn.textContent='Загрузка...'; btn.disabled=true; }
  await loadMessages(fid, true);
};

// ===== АУДИО =====
function initAudio(el) {
  const audio = el.querySelector('audio');
  const playBtn = el.querySelector('.msg-audio-play-btn');
  const iconPlay = el.querySelector('.msg-audio-icon-play');
  const iconPause = el.querySelector('.msg-audio-icon-pause');
  const fill = el.querySelector('.msg-audio-fill');
  const thumb = el.querySelector('.msg-audio-thumb');
  const cur = el.querySelector('.cur');
  const tot = el.querySelector('.tot');
  const speedBtn = el.querySelector('.msg-audio-speed-btn');
  if (!audio || !playBtn) return;

  // Скорости воспроизведения
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let speedIdx = 2; // 1x по умолчанию

  audio.addEventListener('loadedmetadata', () => {
    if (tot && audio.duration && !tot.textContent) {
      const m=Math.floor(audio.duration/60), s=Math.floor(audio.duration%60);
      tot.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }
  });

  // Переключение иконок
  function setPlaying(playing) {
    if (playing) {
      iconPlay.style.display = 'none';
      iconPause.style.display = 'block';
      playBtn.title = 'Пауза';
    } else {
      iconPlay.style.display = 'block';
      iconPause.style.display = 'none';
      playBtn.title = 'Воспроизвести';
    }
  }

  // Обновление прогресса
  function updateProgress() {
    if (audio.paused || audio.ended) {
      setPlaying(false);
      fill.style.width='0%';
      if (thumb) thumb.style.left = '0%';
      cur.textContent='0:00';
      return;
    }
    fill.style.width = (audio.currentTime/audio.duration*100)+'%';
    if (thumb) thumb.style.left = (audio.currentTime/audio.duration*100)+'%';
    const m=Math.floor(audio.currentTime/60), s=Math.floor(audio.currentTime%60);
    cur.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    requestAnimationFrame(updateProgress);
  }

  playBtn.onclick = () => {
    // Остановить все другие аудио
    document.querySelectorAll('.msg-audio-player audio').forEach(a => {
      if(a!==audio) {
        a.pause();
        const otherPlayer = a.closest('.msg-audio-player');
        if (otherPlayer) {
          otherPlayer.classList.remove('playing');
          const oi = otherPlayer.querySelector('.msg-audio-icon-play');
          const op = otherPlayer.querySelector('.msg-audio-icon-pause');
          if (oi) oi.style.display = 'block';
          if (op) op.style.display = 'none';
          const ot = otherPlayer.querySelector('.msg-audio-fill');
          const othumb = otherPlayer.querySelector('.msg-audio-thumb');
          if (ot && a.ended) { ot.style.width='0%'; }
          if (othumb && a.ended) { othumb.style.left='0%'; }
        }
      }
    });
    // Остановить глобальный плеер если играет
    if (window._globalAudioEl && window._globalAudioEl !== audio && !window._globalAudioEl.paused) {
      window._globalAudioEl.pause();
      window._isPlaying = false;
    }
    if (audio.paused) {
      audio.play();
      setPlaying(true);
      el.classList.add('playing');
      updateProgress();
    } else {
      audio.pause();
      setPlaying(false);
      el.classList.remove('playing');
    }
  };

  // Перемотка
  el.querySelector('[data-action="seek-audio"]')?.addEventListener('click', e => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)) * audio.duration;
  });

  // Скорость воспроизведения
  speedBtn?.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    audio.playbackRate = speeds[speedIdx];
    speedBtn.textContent = `${speeds[speedIdx]}x`;
    speedBtn.dataset.speed = speeds[speedIdx];
  });

  // По завершении
  audio.addEventListener('ended', () => {
    setPlaying(false);
    el.classList.remove('playing');
  });
}

// ===== ВИДЕО =====
function initVideo(wrap) {
  const video = wrap.querySelector('.msg-video');
  const playBtn = wrap.querySelector('.msg-video-play-btn');
  const progress = wrap.querySelector('.msg-video-progress');
  const bar = wrap.querySelector('.msg-video-bar');
  const timeEl = wrap.querySelector('.msg-video-time');
  const muteBtn = wrap.querySelector('.msg-video-mute-btn');
  const fullBtn = wrap.querySelector('.msg-video-full-btn');
  if (!video || !playBtn) return;

  // Формат времени
  function fmtTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Обновление времени при загрузке метаданных
  video.addEventListener('loadedmetadata', () => {
    timeEl.textContent = `0:00 / ${fmtTime(video.duration)}`;
  });

  // Play/Pause
  function togglePlay() {
    if (video.paused) {
      // Остановить все другие видео
      document.querySelectorAll('.msg-video-wrap.playing video').forEach(v => {
        if (v !== video) {
          v.pause();
          v.closest('.msg-video-wrap')?.classList.remove('playing');
        }
      });
      // Остановить глобальный аудио плеер
      if (window._globalAudioEl && !window._globalAudioEl.paused) {
        window._globalAudioEl.pause();
        window._isPlaying = false;
      }
      video.play();
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      playBtn.title = 'Пауза';
      wrap.classList.add('playing');
    } else {
      video.pause();
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      playBtn.title = 'Воспроизвести';
      wrap.classList.remove('playing');
    }
  }

  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);

  // Обновление прогресса
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    bar.style.width = (video.currentTime / video.duration * 100) + '%';
    timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
  });

  video.addEventListener('ended', () => {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    playBtn.title = 'Воспроизвести';
    bar.style.width = '0%';
    wrap.classList.remove('playing');
  });

  // Перемотка
  progress?.addEventListener('click', e => {
    if (!video.duration) return;
    const r = progress.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * video.duration;
  });

  // Mute/Unmute
  muteBtn?.addEventListener('click', () => {
    video.muted = !video.muted;
    if (video.muted) {
      muteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
      muteBtn.title = 'Включить звук';
    } else {
      muteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
      muteBtn.title = 'Звук';
    }
  });

  // Полный экран
  fullBtn?.addEventListener('click', () => {
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
    else if (video.msRequestFullscreen) video.msRequestFullscreen();
  });

  // Закрыть видео
  const closeBtn = wrap.querySelector('.msg-video-close-btn');
  closeBtn?.addEventListener('click', () => {
    video.pause();
    video.src = '';
    wrap.style.transition = 'opacity .2s ease, transform .2s ease';
    wrap.style.opacity = '0';
    wrap.style.transform = 'scale(0.95)';
    setTimeout(() => {
      wrap.style.display = 'none';
    }, 200);
  });
}

// ===== МЕДИА =====
let mediaZoom = 1;
window.openMediaViewer = function(url, type) {
  let v = $('#media-viewer');
  if (!v) {
    v = document.createElement('div'); v.id='media-viewer'; v.className='media-viewer';
    v.innerHTML = '<div class="media-viewer-overlay" data-action="close-media-viewer"></div><div class="media-viewer-content"><button class="media-viewer-close" data-action="close-media-viewer">✕</button><div class="media-viewer-body"></div><div class="media-viewer-zoom-controls"><button class="media-viewer-zoom-btn" data-action="zoom-in">+</button><span class="media-viewer-zoom-level">100%</span><button class="media-viewer-zoom-btn" data-action="zoom-out">−</button><button class="media-viewer-zoom-btn" data-action="zoom-reset">⟲</button></div></div>';
    document.body.appendChild(v);
  }
  const body = v.querySelector('.media-viewer-body');
  if (type==='image') body.innerHTML = `<img src="${esc(url)}" class="media-viewer-img" id="media-viewer-image">`;
  else if (type==='video') body.innerHTML = `<video controls autoplay src="${esc(url)}" class="media-viewer-video">`;
  mediaZoom = 1;
  updateMediaZoom();
  v.style.display='flex'; document.body.style.overflow='hidden';
};

window.closeMediaViewer = function() {
  const v = $('#media-viewer');
  if (v) { v.style.display='none'; const b=v.querySelector('.media-viewer-body'); if(b) b.innerHTML=''; }
  document.body.style.overflow = '';
  mediaZoom = 1;
};

function updateMediaZoom() {
  const img = $('#media-viewer-image');
  if (img) img.style.transform = `scale(${mediaZoom})`;
  const lvl = $('.media-viewer-zoom-level');
  if (lvl) lvl.textContent = Math.round(mediaZoom * 100) + '%';
}

// Обработчики зума
document.addEventListener('wheel', e => {
  const v = $('#media-viewer');
  if (!v || v.style.display === 'none') return;
  const img = $('#media-viewer-image');
  if (!img) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  mediaZoom = Math.max(0.3, Math.min(5, mediaZoom + delta));
  updateMediaZoom();
}, { passive: false });

// Двойной клик — зум 2x / сброс
document.addEventListener('dblclick', e => {
  const img = e.target.closest('.media-viewer-img');
  if (!img) return;
  if (mediaZoom > 1.1) {
    mediaZoom = 1;
  } else {
    mediaZoom = 2;
  }
  updateMediaZoom();
});

// ===== ОТПРАВКА =====
async function sendFile(file) {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('/api/messages/upload', { method:'POST', credentials:'include', body:fd });
  if (!res.ok) { const e=await res.json(); throw new Error(e.error); }
  return res.json();
}

async function sendMessage() {
  const input = $('#message-input');
  const text = input?.value.trim();
  if (!text && !pendingFiles.length && !replyTo) return;
  if (!state.chatUserId) return;

  const files = [...pendingFiles];
  pendingFiles = [];
  updateFilePreview();
  if (input) input.value = '';
  clearReply();

  // Удаляем inline editing если есть
  const editBar = $('#edit-bar');
  if (editBar) editBar.remove();
  editingMsgId = null;

  try {
    // Загружаем файлы параллельно
    const uploads = await Promise.all(files.map(f => sendFile(f)));
    
    if (uploads.length === 1 && text) {
      // Один файл + текст
      const up = uploads[0];
      const c = $('#chat-messages');
      c?.querySelector('.empty-state')?.remove();
      const temp = { id:Date.now(), sender_id:userId, content:text, type:up.type, file_url:up.fileUrl, file_name:up.fileName, thumb_url:up.thumbUrl, reply_to:replyTo, is_read:0, created_at:new Date().toISOString() };
      c.insertAdjacentHTML('beforeend', await bubble(temp));
      c.scrollTop = c.scrollHeight;

      await api('/api/messages', {
        method:'POST',
        body: JSON.stringify({ receiverId:state.chatUserId, content:text, type:up.type, fileUrl:up.fileUrl, fileName:up.fileName, thumbUrl:up.thumbUrl, replyTo })
      });
    } else if (uploads.length > 0) {
      // Несколько файлов
      for (const up of uploads) {
        const c = $('#chat-messages');
        c?.querySelector('.empty-state')?.remove();
        const temp = { id:Date.now()+Math.random(), sender_id:userId, content:uploads.indexOf(up)===0?text:'', type:up.type, file_url:up.fileUrl, file_name:up.fileName, thumb_url:up.thumbUrl, reply_to:uploads.indexOf(up)===0?replyTo:null, is_read:0, created_at:new Date().toISOString() };
        c.insertAdjacentHTML('beforeend', await bubble(temp));
        c.scrollTop = c.scrollHeight;

        await api('/api/messages', {
          method:'POST',
          body: JSON.stringify({ receiverId:state.chatUserId, content:uploads.indexOf(up)===0?text:'', type:up.type, fileUrl:up.fileUrl, fileName:up.fileName, thumbUrl:up.thumbUrl, replyTo:uploads.indexOf(up)===0?replyTo:null })
        });
      }
    } else {
      // Только текст
      const c = $('#chat-messages');
      c?.querySelector('.empty-state')?.remove();
      const temp = { id:Date.now(), sender_id:userId, content:text, type:'text', reply_to:replyTo, is_read:0, created_at:new Date().toISOString() };
      c.insertAdjacentHTML('beforeend', await bubble(temp));
      c.scrollTop = c.scrollHeight;

      await api('/api/messages', {
        method:'POST',
        body: JSON.stringify({ receiverId:state.chatUserId, content:text, type:'text', replyTo })
      });
    }

    loadConversations(); loadMessagesCount();
  } catch(err) {
    console.error(err);
    notify(err.message || 'Ошибка отправки', 'error');
  }
}

$('#message-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  await sendMessage();
});

$('#message-input')?.addEventListener('keydown', e => {
  if (e.key==='Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); sendMessage(); }
});

// ===== ФАЙЛЫ =====
function updateFilePreview() {
  const prev = $('#file-preview');
  if (!prev) return;
  if (!pendingFiles.length) { prev.style.display='none'; prev.innerHTML=''; return; }
  
  prev.style.display = 'flex';
  prev.innerHTML = pendingFiles.map((f,i) => {
    const icon = f.type.startsWith('image/') ? '🖼️' : f.type.startsWith('audio/') ? '🎵' : '🎬';
    return `<div class="pending-file">${icon} ${esc(f.name)} <button type="button" data-action="remove-file" data-file-idx="${i}">✕</button></div>`;
  }).join('');
}

$('#message-file-input')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file && state.chatUserId) {
    pendingFiles.push(file);
    updateFilePreview();
  }
  e.target.value = '';
});

// Drag & Drop
function setupDropZone() {
  const chat = $('#chat-active');
  if (!chat) return;
  chat.addEventListener('dragover', e => { e.preventDefault(); chat.classList.add('drag-over'); });
  chat.addEventListener('dragleave', () => chat.classList.remove('drag-over'));
  chat.addEventListener('drop', e => {
    e.preventDefault(); chat.classList.remove('drag-over');
    if (!state.chatUserId) return;
    const files = [...(e.dataTransfer?.files||[])].filter(f=>f.type.match(/^(image|audio|video)/));
    pendingFiles.push(...files);
    updateFilePreview();
  });
}

// ===== REPLY =====
function setReply(msgId, text) {
  replyTo = msgId;
  const input = $('#message-input');
  if (input) {
    input.placeholder = `↪ Ответ на: ${text.substring(0,50)}...`;
    input.focus();
  }
  const bar = $('#reply-bar');
  if (bar) { bar.textContent = `↪ Ответ на сообщение`; bar.style.display = 'flex'; }
}

function clearReply() {
  replyTo = null;
  const input = $('#message-input');
  if (input) input.placeholder = 'Напишите сообщение...';
  const bar = $('#reply-bar');
  if (bar) bar.style.display = 'none';
}

// ===== КЛИКИ =====
document.addEventListener('click', e => {
  // Клик по диалогу
  const convItem = e.target.closest('.conv-item');
  if (convItem && !e.target.closest('a')) {
    e.preventDefault();
    openChat(
      parseInt(convItem.dataset.chatId),
      convItem.dataset.chatName,
      convItem.dataset.chatAvatar,
      convItem.dataset.chatUsername
    );
    return;
  }

  // Удалить файл из превью
  const rmFile = e.target.closest('[data-action="remove-file"]');
  if (rmFile) {
    const idx = parseInt(rmFile.dataset.fileIdx);
    pendingFiles.splice(idx, 1);
    updateFilePreview();
    return;
  }

  // Reply
  const replyBtn = e.target.closest('[data-action="reply"]');
  if (replyBtn) {
    const msgId = parseInt(replyBtn.dataset.msgId);
    const msgEl = replyBtn.closest('.msg');
    const text = msgEl?.querySelector('.msg-text')?.textContent || '';
    setReply(msgId, text);
    return;
  }

  // Edit
  const editBtn = e.target.closest('[data-action="edit"]');
  if (editBtn) {
    const msgId = parseInt(editBtn.dataset.msgId);
    const msgEl = editBtn.closest('.msg');
    const textEl = msgEl?.querySelector('.msg-text');
    if (!textEl) return;
    
    const currentText = textEl.textContent.replace(' (ред.)','');
    textEl.innerHTML = `<textarea class="edit-input" data-msg-id="${msgId}">${esc(currentText)}</textarea>
      <button class="edit-save" data-msg-id="${msgId}">✓</button>
      <button class="edit-cancel" data-msg-id="${msgId}">✕</button>`;
    const ta = textEl.querySelector('.edit-input');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    editingMsgId = msgId;
    return;
  }

  // Save edit
  const saveBtn = e.target.closest('.edit-save');
  if (saveBtn) {
    const msgId = parseInt(saveBtn.dataset.msgId);
    const ta = saveBtn.parentElement.querySelector('.edit-input');
    const newText = ta.value.trim();
    if (!newText) return;
    
    api(`/api/messages/${msgId}`, { method:'PUT', body:JSON.stringify({content:newText}) })
      .then(() => {
        ta.parentElement.textContent = esc(newText) + ' (ред.)';
        notify('Сообщение изменено');
      })
      .catch(err => notify(err.message, 'error'));
    return;
  }

  // Cancel edit
  const cancelBtn = e.target.closest('.edit-cancel');
  if (cancelBtn) {
    const msgEl = cancelBtn.closest('.msg');
    const textEl = msgEl.querySelector('.msg-text');
    // Перезагружаем сообщения
    loadMessages(state.chatUserId);
    return;
  }

  // Delete
  const delBtn = e.target.closest('[data-action="delete"]');
  if (delBtn) {
    const msgId = parseInt(delBtn.dataset.msgId);
    if (!confirm('Удалить сообщение?')) return;
    api(`/api/messages/${msgId}`, { method:'DELETE' })
      .then(() => {
        const msgEl = delBtn.closest('.msg');
        if (msgEl) {
          msgEl.querySelector('.msg-text').innerHTML = '<em>Сообщение удалено</em>';
          msgEl.querySelector('.msg-actions')?.remove();
          msgEl.querySelector('.msg-media')?.remove();
        }
      })
      .catch(err => notify(err.message, 'error'));
    return;
  }

  // Clear reply
  if (e.target.closest('[data-action="clear-reply"]')) { clearReply(); return; }

  if (e.target.closest('[data-action="close-media-viewer"]')) closeMediaViewer();
  const img = e.target.closest('[data-action="view-media"]');
  if (img) { e.preventDefault(); openMediaViewer(img.dataset.url, img.dataset.type); }
  const more = e.target.closest('.load-more');
  if (more) { e.preventDefault(); loadOlderMessages(parseInt(more.dataset.fid)); }

  // Zoom controls
  const zoomIn = e.target.closest('[data-action="zoom-in"]');
  if (zoomIn) { mediaZoom = Math.min(5, mediaZoom + 0.2); updateMediaZoom(); return; }
  const zoomOut = e.target.closest('[data-action="zoom-out"]');
  if (zoomOut) { mediaZoom = Math.max(0.3, mediaZoom - 0.2); updateMediaZoom(); return; }
  const zoomReset = e.target.closest('[data-action="zoom-reset"]');
  if (zoomReset) { mediaZoom = 1; updateMediaZoom(); return; }
});

// Typing
let typingT;
$('#message-input')?.addEventListener('input', () => {
  if (!state.chatUserId) return;
  socket.emit('typing', {toUserId:state.chatUserId});
  clearTimeout(typingT);
  typingT = setTimeout(() => socket.emit('stop_typing', {toUserId:state.chatUserId}), 2000);
});

// Счётчик
window.loadMessagesCount = async function() {
  try {
    const d = await api('/api/messages/count');
    const b = $('#messages-count');
    if (b) { b.textContent=d.count; b.style.display=d.count>0?'inline':'none'; }
  } catch {}
};

// Удаление переписки
window.confirmDeleteChat = async function() {
  if (!state.chatUserId) return notify('Откройте диалог', 'error');
  if (!confirm('Удалить переписку?')) return;
  try {
    const uid = state.chatUserId;
    await api(`/api/messages/${uid}`, {method:'DELETE'});
    state.chatUserId = null;
    $('#chat-active').style.display = 'none';
    $('#chat-empty').style.display = 'flex';
    socket.emit('chat_deleted', {userId:uid});
    loadConversations();
    notify('Переписка удалена');
  } catch(e) { notify('Ошибка', 'error'); }
};

// Init
setupDropZone();
