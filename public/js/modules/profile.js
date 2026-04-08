/**
 * Свой профиль, стена, каталог людей
 */

/**
 * Генерирует HTML карточки поста
 * @param {Object} p — данные поста
 * @param {number} userId — ID текущего пользователя
 * @param {boolean} showComments — показывать контейнер комментариев
 * @returns {string}
 */
function postCardHTML(p, userId, showComments = false) {
  const t = parseUTC(p.created_at).toLocaleString('ru', MOSCOW_DT);
  const own = p.author_id == userId;
  const lk = !!p.liked;
  const cc = p.comment_count || 0;
  const commentsStyle = showComments && cc > 0 ? '' : ' style="display:none;"';
  const av = p.avatar
    ? `<a href="/${esc(p.username)}" class="post-author-link" data-username="${esc(p.username)}"><div class="wall-post-avatar"><img src="${sanitizeUrl(esc(p.avatar))}" alt=""></div></a>`
    : `<a href="/${esc(p.username)}" class="post-author-link" data-username="${esc(p.username)}"><div class="wall-post-avatar-placeholder">${initials(p.display_name || p.username)}</div></a>`;
  const imgHTML = p.image_url
    ? `<div class="wall-post-image"><img src="${sanitizeUrl(esc(p.image_url))}" alt="" loading="lazy" data-action="view-media" data-url="${esc(p.image_url)}" data-type="image"></div>`
    : '';
  const actionBtns = own
    ? `<button class="wall-post-action-btn edit-post" data-post-id="${p.id}" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="wall-post-action-btn delete-post" data-post-id="${p.id}" title="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`
    : '';

  return `<div class="wall-post-card" data-post-id="${p.id}">
    <div class="wall-post-header">
      ${av}
      <div class="wall-post-author">
        <a href="/${esc(p.username)}" class="wall-post-author-name post-author-link" data-username="${esc(p.username)}">${esc(p.display_name || p.username)}</a>
      </div>
      <div class="wall-post-time">${t}</div>
      ${actionBtns}
    </div>
    <div class="wall-post-content" data-post-id="${p.id}">${esc(p.content || '')}</div>${imgHTML}
    <div class="wall-post-actions">
      <button class="wall-post-action-btn like-post ${lk ? 'liked' : ''}" data-post-id="${p.id}" data-likes="${p.likes}">
        <svg viewBox="0 0 24 24" fill="${lk ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
        <span>${p.likes || 0}</span>
      </button>
      <button class="wall-post-action-btn toggle-comments" data-post-id="${p.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <span>Комментарии</span>
        ${cc > 0 ? `<span class="comment-count-badge">${cc}</span>` : ''}
      </button>
    </div>
    <div class="post-comments" data-post-id="${p.id}"${commentsStyle}>
      <div class="comments-list" data-post-id="${p.id}"></div>
      <div class="comment-form">
        <input type="text" class="comment-input" data-post-id="${p.id}" placeholder="Написать комментарий..." maxlength="300">
        <button class="submit-comment" data-post-id="${p.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></button>
      </div>
    </div>
  </div>`;
}

// ======================== ЛЕНТА ========================

async function loadAllUsers() {
  console.log('[profile] loadAllUsers called (feed)');
  try {
    const c = $('#feed-posts');
    if (!c) { console.warn('[profile] #feed-posts not found'); return; }
    c.innerHTML = '<div class="wall-empty"><p>Загрузка...</p></div>';

    // Один запрос вместо N+1 — загружаем все посты сразу
    const data = await api('/api/wall/feed');
    const posts = data.posts || [];

    if (!posts.length) {
      c.innerHTML = '<div class="wall-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><p>Пока нет записей</p></div>';
      return;
    }

    window.renderFeedPosts(c, posts);
    console.log('[profile] Feed loaded:', posts.length, 'posts');
  } catch (e) { console.error('[profile] loadAllUsers error:', e); }
}

/**
 * Рендерит ленту постов
 * @param {Element} container
 * @param {Array} posts
 */
window.renderFeedPosts = async function(container, posts) {
  // Синхронизируем state
  posts.forEach(p => {
    if (!p.liked) { state.likedPosts.delete(p.id); saveLikes(); }
  });

  container.innerHTML = posts.map(p => postCardHTML(p, userId)).join('');

  // Загружаем превью комментариев только для видимых контейнеров (где cc > 0)
  container.querySelectorAll('.post-comments').forEach(el => {
    loadCommentsPreview(el);
  });
};

/**
 * Загружает превью комментариев (3 шт) и показывает контейнер
 * @param {HTMLElement} container - .post-comments div
 */
async function loadCommentsPreview(container) {
    if (!container) return;
    const list = container.querySelector('.comments-list');
    if (!list) return;
    const postId = container.dataset.postId;
    
    try {
        const comments = await api(`/api/wall/post/${postId}/comments`);
        if (!comments.length) return;

        const limit = 3;
        comments.slice(0, limit).forEach(c => {
            const t = parseUTC(c.created_at).toLocaleString('ru', MOSCOW_TIME);
            const av = c.avatar
                ? `<div class="comment-avatar"><img src="${sanitizeUrl(esc(c.avatar))}"></div>`
                : `<div class="comment-avatar-placeholder">${initials(c.display_name || c.username)}</div>`;
            const el = document.createElement('div');
            el.className = 'comment-item';
            el.innerHTML = `
                ${av}<div class="comment-content">
                    <div class="comment-header">
                        <a href="/${esc(c.username)}" class="comment-author post-author-link" data-username="${esc(c.username)}">${esc(c.display_name || c.username)}</a>
                        <span class="comment-time">${t}</span>
                    </div>
                    <div class="comment-text">${esc(c.content)}</div>
                </div>
                ${c.user_id == userId ? `<button class="edit-comment" data-comment-id="${c.id}" data-post-id="${postId}" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="delete-comment" data-comment-id="${c.id}" data-post-id="${postId}" title="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>` : ''}
            `;
            list.appendChild(el);
        });
        
        if (comments.length > 3) {
            const link = document.createElement('div');
            link.className = 'show-more-link';
            link.textContent = `Показать все комментарии (${comments.length})`;
            link.onclick = () => loadComments(postId, container, true);
            list.appendChild(link);
        }

        container.style.display = 'block';
        list.scrollTop = 0;
    } catch (e) { console.error(e); }
}

// ======================== КАТАЛОГ ЛЮДЕЙ ========================

async function loadPeople() {
  const c = $('#people-list');
  if (!c) return;
  c.innerHTML = '<div class="empty-state"><p>Загрузка...</p></div>';
  try {
    const [statuses, users] = await Promise.all([
      api('/api/friends/statuses').catch(() => ({})),
      api('/api/users')
    ]);
    state.friendStatuses = statuses;
    state.usersCache = users;
    if (!users.length) {
      c.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg><p>Пока нет других пользователей</p></div>';
      return;
    }
    renderUsersGridForPeople(users);
  } catch {
    c.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Ошибка загрузки</p><button class="btn btn-primary btn-small" onclick="loadPeople()">Повторить</button></div>';
  }
}

function renderUsersGridForPeople(users) {
  $('#people-list').innerHTML = users.map(u => {
    const s = state.friendStatuses[u.id];
    let btn = '';
    if (!s) btn = `<button class="btn btn-small btn-add" data-action="add-friend" data-id="${u.id}">Добавить</button>`;
    else if (s.status === 'pending' && s.direction === 'sent') btn = `<button class="btn btn-small btn-add" disabled style="opacity:.6;cursor:not-allowed">✓ Заявка отправлена</button>`;
    else if (s.status === 'pending' && s.direction === 'received') btn = `<button class="btn btn-small btn-accept" data-action="accept-from-feed" data-id="${u.id}" data-name="${esc(u.display_name || u.username)}">Принять заявку</button>`;
    else if (s.status === 'accepted') btn = `<button class="btn btn-small btn-danger" data-action="remove-friend-main" data-id="${u.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg><span>Удалить</span></button>`;
    else btn = `<button class="btn btn-small btn-add" data-action="add-friend" data-id="${u.id}">Добавить</button>`;
    return `<div class="user-card-modern"><div class="user-card-avatar-link" data-username="${esc(u.username)}">${avatarHTML(u, 'usercard')}</div><div class="user-card-name"><a href="/${esc(u.username)}" class="post-author-link" data-username="${esc(u.username)}">${esc(u.display_name || u.username)}</a></div><div class="user-card-username">@${esc(u.username)}</div><div class="user-card-status"><span class="status-dot ${u.status === 'online' ? '' : 'offline'}"></span>${u.status === 'online' ? 'Онлайн' : 'Не в сети'}</div><div class="user-card-actions">${btn}<button class="btn btn-small btn-message" data-action="message" data-id="${u.id}" data-name="${esc(u.display_name || u.username)}" data-avatar="${esc(u.avatar || '')}" data-username="${esc(u.username)}">Написать</button></div></div>`;
  }).join('');
}

// Поиск
let searchTimer;
$('#people-search')?.addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = e.target.value.trim().toLowerCase();
    const f = q ? state.usersCache.filter(u => u.username.toLowerCase().includes(q) || (u.display_name && u.display_name.toLowerCase().includes(q))) : state.usersCache;
    f.length ? renderPeopleGrid(f) : ($('#people-list').innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Никого не найдено</p></div>');
  }, 200);
});

// ======================== СВОЙ ПРОФИЛЬ ========================

/**
 * Обновляет аватарку и имя в сайдбаре (user-card).
 * Вызывается при каждой загрузке dashboard.
 */
async function updateUserCard() {
  try {
    const p = await api('/api/profile');
    $('#sidebar-username').textContent = p.display_name || p.username;
    if (p.avatar) {
      const sb = $('#sidebar-avatar');
      if (sb) { sb.querySelector('img').src = p.avatar; sb.style.display = 'block'; $('#sidebar-avatar-placeholder').style.display = 'none'; }
    }
  } catch (e) { console.error('updateUserCard:', e); }
}

async function loadProfile() {
  try {
    const p = await api('/api/profile');
    $('#profile-username').textContent = p.username;
    $('#profile-displayname').textContent = p.display_name || 'Не указано';
    $('#profile-bio-display').textContent = p.bio || 'Пользователь ничего не рассказал о себе';
    if (p.avatar) {
      // Профиль
      $('#profile-avatar').src = p.avatar; $('#profile-avatar').style.display = 'block';
      $('#profile-avatar-placeholder').style.display = 'none';
      // Стена профиля
      $('#post-form-avatar').src = p.avatar; $('#post-form-avatar').style.display = 'block';
      $('#post-form-avatar-placeholder').style.display = 'none';
      // Главная (лента)
      $('#feed-post-avatar').src = p.avatar; $('#feed-post-avatar').style.display = 'block';
      $('#feed-post-avatar-placeholder').style.display = 'none';
    }
    $('#edit-displayname').value = p.display_name || '';
    $('#edit-bio').value = p.bio || '';
    loadWall();
  } catch (e) { console.error('loadProfile:', e); }
}

// Модалка редактирования
$('#edit-profile-btn')?.addEventListener('click', () => { $('#edit-profile-modal').style.display = 'flex'; });
$('#close-edit-modal')?.addEventListener('click', () => { $('#edit-profile-modal').style.display = 'none'; });
$('#cancel-edit-btn')?.addEventListener('click', () => { $('#edit-profile-modal').style.display = 'none'; });
$('#edit-profile-modal')?.addEventListener('click', e => { if (e.target.id === 'edit-profile-modal') $('#edit-profile-modal').style.display = 'none'; });

// Сохранение профиля
$('#profile-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#save-profile-btn');
  try {
    btn.classList.add('saving');
    await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ display_name: $('#edit-displayname').value, bio: $('#edit-bio').value })
    });
    btn.classList.remove('saving'); btn.classList.add('success');
    loadProfile();
    notify('Профиль обновлен!');
    $('#edit-profile-modal').style.display = 'none';
    setTimeout(() => btn.classList.remove('success'), 2000);
  } catch { btn.classList.remove('saving'); notify('Ошибка', 'error'); }
});

// Аватар
let selectedAvatarFile = null;
$('#change-avatar-btn')?.addEventListener('click', () => { $('#avatar-modal').style.display = 'flex'; });
$('#cancel-avatar')?.addEventListener('click', () => { $('#avatar-modal').style.display = 'none'; });
$('#cancel-avatar-btn')?.addEventListener('click', () => { $('#avatar-modal').style.display = 'none'; });
$('#trigger-file-input')?.addEventListener('click', () => { $('#avatar-file').click(); });

$('#avatar-file')?.addEventListener('change', e => {
  if (e.target.files[0]) {
    selectedAvatarFile = e.target.files[0];
    const r = new FileReader();
    r.onload = ev => { 
      $('#avatar-preview').src = ev.target.result; 
      $('#avatar-preview').style.display = 'block'; 
      $('#avatar-preview-container').style.display = 'none';
      $('#avatar-submit-btn').disabled = false;
    };
    r.readAsDataURL(e.target.files[0]);
  }
});
$('#avatar-submit-btn')?.addEventListener('click', async () => {
  if (!selectedAvatarFile) return notify('Выберите файл', 'error');
  const fd = new FormData(); fd.append('avatar', selectedAvatarFile);
  try {
    await api('/api/profile/avatar', { method: 'PUT', body: fd });
    $('#avatar-modal').style.display = 'none';
    loadProfile(); notify('Аватар обновлен!');
    $('#avatar-file').value = ''; $('#avatar-preview-container').style.display = 'none';
    $('#avatar-preview').style.display = 'none';
    selectedAvatarFile = null;
    $('#avatar-submit-btn').disabled = true;
  } catch (e) {
    console.error('[avatar] Ошибка загрузки:', e);
    notify(e.message || 'Ошибка загрузки аватара', 'error');
  }
});

// ======================== СТЕНА ========================

async function loadWall(uid = userId, cid = 'wall-posts') {
  const c = $(`#${cid}`);
  try {
    const data = await api(`/api/wall/${uid}`);
    const posts = data.posts || data; // обратная совместимость
    if (!posts.length) {
      c.innerHTML = '<div class="wall-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><p>Пока нет записей</p></div>';
      return;
    }
    c.innerHTML = posts.map(p => {
      // Синхронизируем state с сервером
      if (!p.liked) { state.likedPosts.delete(p.id); saveLikes(); }
      return postCardHTML(p, userId, true);
    }).join('');

    // Загружаем превью комментариев для каждого поста
    c.querySelectorAll('.post-comments').forEach(el => {
        loadCommentsPreview(el);
    });
  } catch (e) { c.innerHTML = `<p>Ошибка: ${e.message}</p>`; }
}

// Публикация поста на главной
$('#feed-publish-btn')?.addEventListener('click', () => publishPost(userId, 'feed-post-content', 'feed-char-count', 'feed-posts'));

// Счётчик символов на главной
$('#feed-post-content')?.addEventListener('input', e => {
  const c = e.target.value.length, ctr = $('#feed-char-count');
  if (!ctr) return;
  ctr.textContent = `${c}/500`;
  ctr.classList.remove('warning', 'error');
  if (c > 450) ctr.classList.add('error'); else if (c > 400) ctr.classList.add('warning');
});

// Публикация поста на своей стене
$('#publish-post-btn')?.addEventListener('click', () => publishPost());
// Флаги защиты от двойного клика
const publishingPosts = new Set();

async function publishPost(uid = userId, inId = 'post-content', ctrId = 'char-count', wId = 'wall-posts') {
  // Защита от двойного клика
  const publishKey = `${uid}-${inId}`;
  if (publishingPosts.has(publishKey)) return;
  publishingPosts.add(publishKey);

  const ta = $(`#${inId}`);
  const content = ta?.value.trim();
  const fileId = inId === 'feed-post-content' ? 'feed-post-file' : inId === 'other-post-content' ? 'other-post-file' : 'post-file';
  const fileInput = $(`#${fileId}`);
  const file = fileInput?.files?.[0];

  if (!content && !file) return notify('Добавьте текст или изображение', 'error');
  if (content && content.length > 500) return notify('Максимум 500 символов', 'error');

  const fd = new FormData();
  if (content) fd.append('content', content);
  if (file) fd.append('image', file);

  try {
    await fetch(`/api/wall/${uid}`, {
      method: 'POST',
      credentials: 'include',
      body: fd
    }).then(r => {
      if (!r.ok) return r.json().then(d => { throw new Error(d.error); });
      return r.json();
    });

    ta.value = '';
    $(`#${ctrId}`).textContent = '0/500';

    // Очищаем превью изображения
    const cleanupMap = {
      'feed-post-content': { preview: 'feed-post-image-preview', file: 'feed-post-file' },
      'post-content': { preview: 'post-image-preview', file: 'post-file' },
      'other-post-content': { preview: 'other-post-image-preview', file: 'other-post-file' }
    };
    const cleanup = cleanupMap[inId];
    if (cleanup) {
      const preview = $(`#${cleanup.preview}`);
      if (preview) preview.style.display = 'none';
      const fi = $(`#${cleanup.file}`);
      if (fi) fi.value = '';
    }

    if (wId === 'feed-posts') loadAllUsers();
    else await loadWall(uid, wId);
    notify('Пост опубликован!');
  } catch (e) { notify('Ошибка: ' + e.message, 'error'); }
  finally { publishingPosts.delete(publishKey); }
}

// Прикрепление изображений к постам
$$('.btn-attach-post').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const fileInput = $(`#${target === 'feed' ? 'feed-post-file' : target === 'other' ? 'other-post-file' : 'post-file'}`);
    fileInput?.click();
  });
});

// Обработка выбора файла
['feed-post-file', 'post-file', 'other-post-file'].forEach(fileId => {
  const el = $(`#${fileId}`);
  if (!el) return;
  el.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notify('Только изображения', 'error');
      e.target.value = '';
      return;
    }

    // Маппинг ID файла → ID превью
    const mapping = {
      'feed-post-file': { preview: 'feed-post-image-preview', img: 'feed-post-image' },
      'post-file': { preview: 'post-image-preview', img: 'post-image' },
      'other-post-file': { preview: 'other-post-image-preview', img: 'other-post-image' }
    };
    const m = mapping[fileId];

    const reader = new FileReader();
    reader.onload = ev => {
      const img = $(`#${m.img}`);
      const preview = $(`#${m.preview}`);
      if (img) img.src = ev.target.result;
      if (preview) preview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });
});

// Drag & Drop для постов
(function initPostDragDrop() {
  const forms = [
    { card: () => document.querySelector('#feed-page > .post-form-card'), file: 'feed-post-file', preview: 'feed-post-image-preview', img: 'feed-post-image' },
    { card: () => document.querySelector('.profile-page-modern > .post-form-card'), file: 'post-file', preview: 'post-image-preview', img: 'post-image' },
    { card: () => $('#other-post-form'), file: 'other-post-file', preview: 'other-post-image-preview', img: 'other-post-image' }
  ];

  forms.forEach(({ card: getCard, file: fileId, preview: previewId, img: imgId }) => {
    setTimeout(() => {
      const card = getCard();
      if (!card) return;

      ['dragenter', 'dragover'].forEach(evt => {
        card.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); card.classList.add('drag-over'); });
      });
      ['dragleave', 'drop'].forEach(evt => {
        card.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); card.classList.remove('drag-over'); });
      });
      card.addEventListener('drop', e => {
        e.preventDefault();
        const fileInput = $(`#${fileId}`);
        if (!fileInput) return;
        const files = [...(e.dataTransfer?.files || [])];
        const imgFile = files.find(f => f.type.startsWith('image/'));
        if (!imgFile) return notify('Только изображения', 'error');

        const dt = new DataTransfer();
        dt.items.add(imgFile);
        fileInput.files = dt.files;

        const reader = new FileReader();
        reader.onload = ev => {
          const img = $(`#${imgId}`);
          const preview = $(`#${previewId}`);
          if (img) img.src = ev.target.result;
          if (preview) preview.style.display = 'flex';
        };
        reader.readAsDataURL(imgFile);
      });
    }, 200);
  });
})();

// Удаление превью изображения
$$('.post-image-remove').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const mapping = {
      feed: { preview: 'feed-post-image-preview', file: 'feed-post-file' },
      post: { preview: 'post-image-preview', file: 'post-file' },
      other: { preview: 'other-post-image-preview', file: 'other-post-file' }
    };
    const m = mapping[target];
    if (!m) return;
    const preview = $(`#${m.preview}`);
    if (preview) preview.style.display = 'none';
    const fileInput = $(`#${m.file}`);
    if (fileInput) fileInput.value = '';
  });
});

// Счётчик символов
['post-content', 'other-post-content'].forEach((id, i) => {
  const el = $(`#${id}`), ctr = $(`#${i ? 'other-char-count' : 'char-count'}`);
  el?.addEventListener('input', () => {
    const c = el.value.length;
    ctr.textContent = `${c}/500`;
    ctr.classList.remove('warning', 'error');
    if (c > 450) ctr.classList.add('error'); else if (c > 400) ctr.classList.add('warning');
  });
});

// Публикация на стене другого пользователя
$('#other-publish-post-btn')?.addEventListener('click', () => {
  if (!state.otherUserId) return notify('Откройте профиль пользователя', 'error');
  publishPost(state.otherUserId, 'other-post-content', 'other-char-count', 'other-wall-posts');
});

// Комментарии
window.loadComments = async function(postId, card, showAll = false) {
  const list = $(`.comments-list[data-post-id="${postId}"]`);
  if (!list) return;
  const sec = list.closest('.post-comments');

  try {
    const comments = await api(`/api/wall/post/${postId}/comments`);
    list.innerHTML = '';

    if (comments.length === 0) {
      list.innerHTML = '<div class="no-comments">Будьте первым — напишите комментарий</div>';
      if (sec) { sec.style.display = ''; sec.classList.remove('collapsed'); }
      return;
    }

    // Логика отображения: показываем 3 или все
    const limit = showAll ? comments.length : 3;
    const shown = comments.slice(0, limit);

    shown.forEach(c => {
      const t = parseUTC(c.created_at).toLocaleString('ru', MOSCOW_TIME);
      const av = c.avatar
        ? `<div class="comment-avatar"><img src="${sanitizeUrl(esc(c.avatar))}"></div>`
        : `<div class="comment-avatar-placeholder">${initials(c.display_name || c.username)}</div>`;

      const el = document.createElement('div');
      el.className = 'comment-item';
      el.innerHTML = `
        ${av}<div class="comment-content">
          <div class="comment-header">
            <a href="/${esc(c.username)}" class="comment-author post-author-link" data-username="${esc(c.username)}">${esc(c.display_name || c.username)}</a>
            <span class="comment-time">${t}</span>
          </div>
          <div class="comment-text">${esc(c.content)}</div>
        </div>
        ${c.user_id == userId ? `<button class="edit-comment" data-comment-id="${c.id}" data-post-id="${postId}" title="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="delete-comment" data-comment-id="${c.id}" data-post-id="${postId}" title="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg></button>` : ''}
      `;
      list.appendChild(el);
    });

    // Если есть ещё комментарии и мы не показали все — добавляем ссылку
    if (!showAll && comments.length > 3) {
      const link = document.createElement('div');
      link.className = 'show-more-link';
      link.textContent = `Показать все комментарии (${comments.length})`;
      link.onclick = () => loadComments(postId, card, true);
      list.appendChild(link);
    }

    // Показываем контейнер
    if (sec) {
      sec.style.display = '';
      sec.classList.remove('collapsed');
      // Обновляем текст кнопки
      const tc = card?.querySelector('.toggle-comments');
      if (tc) tc.querySelector('span').textContent = 'Скрыть';
    }

    list.scrollTop = 0;
  } catch (e) { console.error('loadComments:', e); }
};
