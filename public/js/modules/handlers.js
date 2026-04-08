/**
 * Глобальные обработчики кликов (делегирование событий)
 */
document.addEventListener('click', async e => {
  // ======================== КЛИК ПО ДИАЛОГУ ========================
  if (e.target.closest('.conversation-item-modern') && !e.target.closest('a') && !e.target.closest('button')) {
    const ci = e.target.closest('.conversation-item-modern');
    if (ci) {
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
