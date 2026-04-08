/**
 * Глобальные обработчики кликов (делегирование событий)
 */
const stopLink = e => { e.preventDefault(); e.stopPropagation(); };

document.addEventListener('click', async e => {
  // ======================== КЛИК ПО ДИАЛОГУ ========================
  if (e.target.closest('.conversation-item-modern')) {
    const ci = e.target.closest('.conversation-item-modern');
    // На мобильном — всегда открываем чат (не переходим по ссылке)
    if (ci && window.innerWidth <= 768) {
      e.preventDefault();
      e.stopPropagation();
      // Останавливаем переход по ссылке внутри
      if (e.target.closest('a')) {
        e.target.closest('a').addEventListener('click', stopLink, { once: true });
      }
      console.log('[handlers] Clicked conversation:', ci.dataset.chatId, ci.dataset.chatName);
      if (typeof window.openChat === 'function') {
        window.openChat(parseInt(ci.dataset.chatId), ci.dataset.chatName, ci.dataset.chatAvatar, ci.dataset.chatUsername);
      } else {
        console.error('[handlers] window.openChat is not defined');
      }
      return;
    }
    // На десктопе — только если не клик по ссылке
    if (ci && !e.target.closest('a') && !e.target.closest('button')) {
      e.preventDefault();
      console.log('[handlers] Clicked conversation:', ci.dataset.chatId, ci.dataset.chatName);
      if (typeof window.openChat === 'function') {
        window.openChat(parseInt(ci.dataset.chatId), ci.dataset.chatName, ci.dataset.chatAvatar, ci.dataset.chatUsername);
      } else {
        console.error('[handlers] window.openChat is not defined');
      }
      return;
    }
  }

  // ======================== КЛИК ПО АВАТАРКЕ ========================
  if (e.target.closest('.user-card-avatar-link')) {
    const al = e.target.closest('.user-card-avatar-link');
    if (al?.dataset.username) {
      e.preventDefault(); e.stopPropagation();
      window.openUserProfileByUsername(al.dataset.username);
    }
    return;
  }

  // ======================== ПРОСМОТР АВАТАРКИ ========================
  const avatarImg = e.target.closest('.avatar-img-clickable') || e.target.closest('.wall-post-avatar img') || e.target.closest('.conversation-avatar-wrapper img') || e.target.closest('.user-avatar-small img');
  if (avatarImg && avatarImg.src && !avatarImg.src.includes('placeholder')) {
    e.preventDefault(); e.stopPropagation();
    if (typeof window.openMediaViewer === 'function') {
      window.openMediaViewer(avatarImg.src, 'image');
    }
    return;
  }

  // ======================== ЛАЙК ========================
  const likeBtn = e.target.closest('.like-post');
  if (likeBtn) {
    e.preventDefault(); e.stopPropagation();
    const postId = Number(likeBtn.dataset.postId);
    const span = likeBtn.querySelector('span');
    const isLiked = likeBtn.classList.contains('liked');
    const count = parseInt(span.textContent) || 0;

    if (isLiked) {
      // Оптимистично убираем лайк
      likeBtn.classList.remove('liked');
      likeBtn.querySelector('svg').setAttribute('fill', 'none');
      span.textContent = Math.max(0, count - 1);
      try {
        await api(`/api/wall/like/${postId}`, { method: 'DELETE' });
        // Только после успеха убираем из state
        state.likedPosts.delete(postId); saveLikes();
      } catch (e) {
        // Откат
        likeBtn.classList.add('liked');
        likeBtn.querySelector('svg').setAttribute('fill', 'currentColor');
        span.textContent = count;
        state.likedPosts.add(postId); saveLikes();
        console.error('[handlers] Ошибка при удалении лайка:', e);
      }
    } else {
      // Оптимистично ставим лайк
      likeBtn.classList.add('liked');
      likeBtn.querySelector('svg').setAttribute('fill', 'currentColor');
      span.textContent = count + 1;
      try {
        await api(`/api/wall/like/${postId}`, { method: 'POST' });
        // Только после успеха добавляем в state
        state.likedPosts.add(postId); saveLikes();
      } catch (e) {
        // Откат
        likeBtn.classList.remove('liked');
        likeBtn.querySelector('svg').setAttribute('fill', 'none');
        span.textContent = count;
        state.likedPosts.delete(postId); saveLikes();
        if (e.message !== 'Вы уже лайкнули этот пост') {
          console.error('[handlers] Ошибка при лайке:', e);
        }
      }
    }
    return;
  }

  // ======================== УДАЛИТЬ ПОСТ ========================
  const delBtn = e.target.closest('.delete-post');
  if (delBtn) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm('Удалить пост?')) return;
    try {
      await api(`/api/wall/${delBtn.dataset.postId}`, { method: 'DELETE' });
      const card = delBtn.closest('.wall-post-card');
      if (card) {
        if (card.closest('#feed-posts')) loadAllUsers();
        else if (card.closest('#other-wall-posts')) loadWall(window.location.pathname.slice(1), 'other-wall-posts');
        else loadWall();
      } else { loadWall(); }
      notify('Пост удален');
    } catch { notify('Ошибка', 'error'); }
    return;
  }

  // ======================== КОММЕНТАРИИ (показать/скрыть) ========================
  const tc = e.target.closest('.toggle-comments');
  if (tc) {
    e.preventDefault(); e.stopPropagation();
    const postId = tc.dataset.postId;
    const sec = tc.closest('.wall-post-card')?.querySelector('.post-comments');
    if (!sec) return;

    const isHidden = sec.style.display === 'none';

    if (isHidden) {
      // Показываем — загружаем если пусто
      const list = sec.querySelector('.comments-list');
      if (list && !list.children.length) {
        loadComments(postId, sec.closest('.wall-post-card'));
      } else {
        sec.style.display = '';
        tc.querySelector('span').textContent = 'Скрыть';
      }
    } else {
      // Скрываем
      sec.style.display = 'none';
      tc.querySelector('span').textContent = 'Комментарии';
    }
    return;
  }

  // ======================== ОТПРАВИТЬ КОММЕНТАРИЙ ========================
  const sc = e.target.closest('.submit-comment');
  if (sc) {
    e.preventDefault(); e.stopPropagation();
    const postId = sc.dataset.postId;
    const input = sc.closest('.comment-form')?.querySelector('.comment-input');
    if (!input?.value.trim()) return;
    try {
      await api(`/api/wall/post/${postId}/comments`, { method: 'POST', body: JSON.stringify({ content: input.value.trim() }) });
      input.value = '';
      await loadComments(postId, sc.closest('.wall-post-card'));
    } catch (e) {
      console.error('[handlers] Ошибка отправки комментария:', e);
      notify('Ошибка отправки комментария', 'error');
    }
    return;
  }

  // ======================== КОММЕНТАРИЙ НА ENTER ========================
  // (добавляется через delegation на document)
});

// Enter для отправки комментария
document.addEventListener('keydown', async e => {
  if (e.target.classList.contains('comment-input') && e.key === 'Enter') {
    e.preventDefault();
    const input = e.target;
    const postId = input.dataset.postId;
    if (!input.value.trim() || !postId) return;
    const card = input.closest('.wall-post-card');
    try {
      await api(`/api/wall/post/${postId}/comments`, { method: 'POST', body: JSON.stringify({ content: input.value.trim() }) });
      input.value = '';
      if (typeof loadComments === 'function') await loadComments(Number(postId), card);
      else if (typeof loadCommentsPreview === 'function') await loadCommentsPreview(card);
    } catch (err) {
      console.error('[handlers] Ошибка отправки комментария:', err);
      notify('Ошибка отправки комментария', 'error');
    }
  }
});

// Продолжение click обработчика
document.addEventListener('click', async e => {
  // ======================== УДАЛИТЬ КОММЕНТАРИЙ ========================
  const dc = e.target.closest('.delete-comment');
  if (dc) {
    e.preventDefault(); e.stopPropagation();
    try {
      await api(`/api/wall/comment/${dc.dataset.commentId}`, { method: 'DELETE' });
      await loadComments(dc.dataset.postId, dc.closest('.wall-post-card'));
    } catch (e) {
      console.error('[handlers] Ошибка удаления комментария:', e);
      notify('Ошибка удаления комментария', 'error');
    }
    return;
  }

  // ======================== РЕДАКТИРОВАТЬ ПОСТ ========================
  const editPostBtn = e.target.closest('.edit-post');
  if (editPostBtn) {
    e.preventDefault(); e.stopPropagation();
    const postId = editPostBtn.dataset.postId;
    const card = editPostBtn.closest('.wall-post-card');
    const contentEl = card.querySelector('.wall-post-content');
    if (!contentEl || card.dataset.editing) return;
    card.dataset.editing = '1';

    const original = contentEl.textContent;
    card.dataset.originalContent = original;
    contentEl.innerHTML = `<textarea class="edit-post-textarea" style="width:100%;min-height:60px;padding:10px;border:1.5px solid var(--border-color);border-radius:10px;background:var(--bg-tertiary);color:var(--text-primary);font-size:14px;font-family:inherit;resize:vertical;outline:none;">${esc(original)}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;">
        <button class="cancel-edit-post" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:13px;">Отмена</button>
        <button class="save-edit-post" data-post-id="${postId}" style="padding:6px 14px;border-radius:8px;border:none;background:var(--primary);color:white;cursor:pointer;font-size:13px;font-weight:600;">Сохранить</button>
      </div>`;
    const ta = contentEl.querySelector('.edit-post-textarea');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    return;
  }

  // Сохранить редактируемый пост
  const savePostBtn = e.target.closest('.save-edit-post');
  if (savePostBtn) {
    e.preventDefault(); e.stopPropagation();
    const postId = savePostBtn.dataset.postId;
    const card = savePostBtn.closest('.wall-post-card');
    const contentEl = card.querySelector('.wall-post-content');
    const ta = contentEl.querySelector('.edit-post-textarea');
    const newContent = ta.value.trim();
    if (!newContent || newContent.length > 500) return notify('Максимум 500 символов', 'error');

    try {
      await api(`/api/wall/${postId}`, { method: 'PUT', body: JSON.stringify({ content: newContent }) });
      contentEl.textContent = newContent;
      delete card.dataset.editing;
      delete card.dataset.originalContent;
      notify('Пост обновлен');
    } catch { notify('Ошибка', 'error'); delete card.dataset.editing; delete card.dataset.originalContent; }
    return;
  }

  // Отменить редактирование поста
  if (e.target.closest('.cancel-edit-post')) {
    e.preventDefault(); e.stopPropagation();
    const card = e.target.closest('.wall-post-card');
    if (card) {
      delete card.dataset.editing;
      if (card.closest('#feed-posts')) loadAllUsers();
      else loadWall();
    }
    return;
  }

  // ======================== РЕДАКТИРОВАТЬ КОММЕНТАРИЙ ========================
  const editCommentBtn = e.target.closest('.edit-comment');
  if (editCommentBtn) {
    e.preventDefault(); e.stopPropagation();
    const commentId = editCommentBtn.dataset.commentId;
    const postId = editCommentBtn.dataset.postId;
    const commentItem = editCommentBtn.closest('.comment-item');
    const textEl = commentItem.querySelector('.comment-text');
    if (!textEl || commentItem.dataset.editing) return;
    commentItem.dataset.editing = '1';

    const original = textEl.textContent;
    textEl.innerHTML = `<textarea class="edit-comment-textarea" style="width:100%;min-height:36px;padding:8px;border:1.5px solid var(--border-color);border-radius:8px;background:var(--bg-tertiary);color:var(--text-primary);font-size:13px;font-family:inherit;resize:vertical;outline:none;">${esc(original)}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end;">
        <button class="cancel-edit-comment" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-primary);cursor:pointer;font-size:12px;">Отмена</button>
        <button class="save-edit-comment" data-comment-id="${commentId}" data-post-id="${postId}" style="padding:4px 10px;border-radius:6px;border:none;background:var(--primary);color:white;cursor:pointer;font-size:12px;font-weight:600;">Сохранить</button>
      </div>`;
    const ta = textEl.querySelector('.edit-comment-textarea');
    ta.focus();
    return;
  }

  // Сохранить редактируемый комментарий
  const saveCommentBtn = e.target.closest('.save-edit-comment');
  if (saveCommentBtn) {
    e.preventDefault(); e.stopPropagation();
    const commentId = saveCommentBtn.dataset.commentId;
    const postId = saveCommentBtn.dataset.postId;
    const commentItem = saveCommentBtn.closest('.comment-item');
    const textEl = commentItem.querySelector('.comment-text');
    const ta = textEl.querySelector('.edit-comment-textarea');
    const newContent = ta.value.trim();
    if (!newContent || newContent.length > 300) return notify('Максимум 300 символов', 'error');

    try {
      await api(`/api/wall/comment/${commentId}`, { method: 'PUT', body: JSON.stringify({ content: newContent }) });
      textEl.textContent = newContent;
      delete commentItem.dataset.editing;
      notify('Комментарий обновлен');
    } catch { notify('Ошибка', 'error'); delete commentItem.dataset.editing; }
    return;
  }

  // Отменить редактирование комментария
  if (e.target.closest('.cancel-edit-comment')) {
    e.preventDefault(); e.stopPropagation();
    const commentItem = e.target.closest('.comment-item');
    if (commentItem) {
      delete commentItem.dataset.editing;
      const postId = e.target.closest('.comment-item')?.querySelector('.save-edit-comment')?.dataset.postId;
      await loadComments(postId, commentItem.closest('.wall-post-card'));
    }
    return;
  }

  const button = e.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const id = parseInt(button.dataset.id);
  e.preventDefault();
  e.stopPropagation();

  // Удалить друга
  if (action === 'remove-friend-main' || action === 'remove-friend') {
    if (!confirm('Удалить из друзей?')) return;
    try {
      await api(`/api/friends/${id}`, { method: 'DELETE' });
      delete state.friendStatuses[id];
      await loadFriends();
      if (typeof renderUsersGridForPeople === 'function') renderUsersGridForPeople(state.usersCache);
      notify('Удален из друзей');
    } catch { notify('Ошибка', 'error'); }
    return;
  }

  // Принять заявку (из ленты)
  if (action === 'accept-from-feed') {
    try {
      const reqs = await api('/api/friends/requests');
      const req = reqs.find(r => r.user_id === id);
      if (!req) return notify('Заявка не найдена', 'error');
      await api(`/api/friends/accept/${req.friendship_id}`, { method: 'PUT' });
      state.friendStatuses[id] = { status: 'accepted', direction: 'mutual' };
      await loadFriendRequests(); await loadFriends();
      if (typeof renderUsersGridForPeople === 'function') renderUsersGridForPeople(state.usersCache);
      await loadFriendRequestsCount();
      notify(`Заявка от ${button.dataset.name} принята!`);
    } catch { notify('Ошибка', 'error'); }
    return;
  }

  // Принять заявку (вкладка Друзья)
  if (action === 'accept-request') {
    try {
      await api(`/api/friends/accept/${id}`, { method: 'PUT' });
      const reqs = await api('/api/friends/requests');
      const req = reqs.find(r => r.friendship_id === id);
      if (req) state.friendStatuses[req.user_id] = { status: 'accepted', direction: 'mutual' };
      await loadFriendRequests(); await loadFriends();
      await loadFriendRequestsCount();
      if (typeof renderUsersGridForPeople === 'function') renderUsersGridForPeople(state.usersCache);
      notify('Заявка принята!');
    } catch { notify('Ошибка', 'error'); }
    return;
  }

  // Отклонить заявку
  if (action === 'reject-request') {
    try {
      await api(`/api/friends/reject/${id}`, { method: 'DELETE' });
      const reqs = await api('/api/friends/requests');
      const req = reqs.find(r => r.friendship_id === id);
      if (req) delete state.friendStatuses[req.user_id];
      await loadFriendRequests();
      if (typeof renderUsersGridForPeople === 'function') renderUsersGridForPeople(state.usersCache);
      notify('Заявка отклонена');
    } catch { notify('Ошибка', 'error'); }
    return;
  }

  // Написать сообщение
  if (action === 'message') {
    await openChat(id, button.dataset.name, button.dataset.avatar, button.dataset.username || '');
    return;
  }

  // Отправить заявку
  if (action === 'add-friend') {
    try {
      await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ friendId: id }) });
      state.friendStatuses[id] = { status: 'pending', direction: 'sent' };
      if (typeof renderUsersGridForPeople === 'function') renderUsersGridForPeople(state.usersCache);
      notify('Заявка отправлена!');
    } catch { notify('Ошибка', 'error'); }
    return;
  }

  // Принять заявку из профиля
  if (action === 'accept-from-profile') {
    try {
      const reqs = await api('/api/friends/requests');
      const req = reqs.find(r => r.user_id === id);
      if (!req) return notify('Заявка не найдена', 'error');
      await api(`/api/friends/accept/${req.friendship_id}`, { method: 'PUT' });
      state.friendStatuses[id] = { status: 'accepted', direction: 'mutual' };
      await loadFriendRequests(); await loadFriends();
      notify('Заявка принята!');
      const ac = $('#other-profile-actions');
      if (ac) ac.innerHTML = `<button class="btn btn-success btn-modern" disabled>✓ В друзьях</button><button class="btn btn-secondary btn-modern" data-action="message" data-id="${id}" data-name="${button.dataset.name || ''}" data-avatar="${button.dataset.avatar || ''}">Написать сообщение</button>`;
    } catch { notify('Ошибка', 'error'); }
    return;
  }

});
