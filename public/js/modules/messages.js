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
    if (msg.sender_id != state.chatUserId) return;
    const c = $('#chat-messages');
    c?.querySelector('.empty-state')?.remove();
    c.insertAdjacentHTML('beforeend', await bubble(msg));
    c.scrollTop = c.scrollHeight;
    loadConversations();
    loadMessagesCount();
  });
  socket.on('message_sent', async msg => {
    const c = $('#chat-messages');
    c?.querySelector('.empty-state')?.remove();
    c.insertAdjacentHTML('beforeend', await bubble(msg));
    c.scrollTop = c.scrollHeight;
    loadConversations();
    loadMessagesCount();
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
    c.querySelectorAll('.audio-player').forEach(initAudio);
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
      media = `<div class="msg-media"><div class="audio-player" data-src="${esc(m.file_url)}">
        <button class="audio-play-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
        <div class="audio-info"><div class="audio-name">${esc(name.replace(/\.[^.]+$/,''))}</div>
        <div class="audio-progress" data-action="seek-audio"><div class="audio-bar"><div class="audio-fill"></div></div></div>
        <div class="audio-time"><span class="cur">0:00</span> <span class="tot"></span></div></div>
        <audio src="${esc(m.file_url)}" preload="metadata"></audio>
      </div></div>`;
    } else if (m.type==='video' || /\.(mp4|webm)$/.test(ext)) {
      media = `<div class="msg-media"><video controls src="${esc(m.file_url)}" class="msg-video" preload="metadata"></video></div>`;
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
  const btn = el.querySelector('.audio-play-btn');
  const fill = el.querySelector('.audio-fill');
  const cur = el.querySelector('.cur');
  const tot = el.querySelector('.tot');
  if (!audio || !btn) return;

  audio.addEventListener('loadedmetadata', () => {
    if (tot && audio.duration && !tot.textContent) {
      const m=Math.floor(audio.duration/60), s=Math.floor(audio.duration%60);
      tot.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }
  });

  btn.onclick = () => {
    if (audio.paused) {
      document.querySelectorAll('.audio-player audio').forEach(a => { if(a!==audio) a.pause(); });
      audio.play();
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      const tick = () => {
        if (audio.paused || audio.ended) {
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
          fill.style.width='0%'; cur.textContent='0:00'; return;
        }
        fill.style.width = (audio.currentTime/audio.duration*100)+'%';
        const m=Math.floor(audio.currentTime/60), s=Math.floor(audio.currentTime%60);
        cur.textContent = `${m}:${s.toString().padStart(2,'0')}`;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      audio.pause();
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
  };

  el.querySelector('[data-action="seek-audio"]')?.addEventListener('click', e => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)) * audio.duration;
  });
}

// ===== МЕДИА =====
window.openMediaViewer = function(url, type) {
  let v = $('#media-viewer');
  if (!v) {
    v = document.createElement('div'); v.id='media-viewer'; v.className='media-viewer';
    v.innerHTML = '<div class="media-viewer-overlay" data-action="close-media-viewer"></div><div class="media-viewer-content"><button class="media-viewer-close" data-action="close-media-viewer">✕</button><div class="media-viewer-body"></div></div>';
    document.body.appendChild(v);
  }
  const body = v.querySelector('.media-viewer-body');
  if (type==='image') body.innerHTML = `<img src="${esc(url)}" class="media-viewer-img">`;
  else if (type==='video') body.innerHTML = `<video controls autoplay src="${esc(url)}" class="media-viewer-video">`;
  v.style.display='flex'; document.body.style.overflow='hidden';
};

window.closeMediaViewer = function() {
  const v = $('#media-viewer');
  if (v) { v.style.display='none'; const b=v.querySelector('.media-viewer-body'); if(b) b.innerHTML=''; }
  document.body.style.overflow = '';
};

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
