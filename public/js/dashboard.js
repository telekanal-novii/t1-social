/**
 * T1 Сеть — Dashboard (Client Entry Point)
 * Загружается после всех модулей
 */

// Проверяем авторизацию — загружаем профиль
(async function init() {
  try {
    const profile = await api('/api/profile');
    window.currentUserId = profile.id;
    window.currentUsername = profile.username;

    // === Инициализация E2E шифрования ===
    const savedKey = localStorage.getItem('e2e_private_key');
    if (savedKey) {
      // Импортируем существующий приватный ключ
      try {
        const jwk = JSON.parse(savedKey);
        await E2E.importPrivateKey(jwk);
        console.log('[E2E] Приватный ключ загружен');
      } catch (e) {
        console.error('[E2E] Ошибка импорта ключа, перегенерация:', e);
        await generateAndSaveKeys();
      }
    } else {
      // Генерируем новые ключи
      await generateAndSaveKeys();
    }

    async function generateAndSaveKeys() {
      const { publicKey } = await E2E.generateKeys();
      const jwk = await E2E.exportPrivateKey();
      localStorage.setItem('e2e_private_key', JSON.stringify(jwk));
      // Сохраняем публичный ключ на сервере (в bio временно)
      try {
        await api('/api/profile', {
          method: 'PUT',
          body: JSON.stringify({ display_name: profile.display_name || '', bio: profile.bio || '', e2e_public_key: publicKey })
        });
      } catch {}
      console.log('[E2E] Новые ключи сгенерированы');
    }

    // Инициализация навигации и роутинга
    if (typeof initNavigation === 'function') initNavigation();

    // Обновляем user-card в сайдбаре на ЛЮБОЙ странице
    if (typeof updateUserCard === 'function') updateUserCard();

    // Splash: держим до полной загрузки всех ресурсов
    const splash = document.getElementById('app-splash');
    if (splash) {
      const hide = () => {
        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
        setTimeout(() => splash.remove(), 250);
      };
      if (document.readyState === 'complete') {
        hide();
      } else {
        window.addEventListener('load', hide, { once: true });
        setTimeout(hide, 5000);
      }
    }

    // Фоновое обновление ТОЛЬКО счётчиков (не ломает контент страницы)
    setInterval(loadFriendRequestsCount, 30000);
    setInterval(loadMessagesCount, 30000);

    // Диалоги обновляются только если НЕ открыт чат
    setInterval(() => {
      if (typeof currentPage !== 'undefined' && currentPage === 'messages' && typeof state !== 'undefined' && !state.chatUserId) loadConversations();
    }, 30000);
  } catch {
    // Не авторизован — редирект
    document.body.style.display = '';
    window.location.href = '/';
  }
})();

// === Бесшовное обновление ленты ===
if (typeof socket !== 'undefined') {
  socket.on('new_post', async (post) => {
    // Добавляем пост только если мы на странице ленты
    if (typeof currentPage === 'undefined' || currentPage !== 'feed') return;

    // Если активен фильтр 'Мои' — пост от другого пользователя не показываем
    if (typeof feedState !== 'undefined' && feedState.filter === 'mine' && post.author_id !== window.currentUserId) return;

    // Если активен фильтр 'Друзья' — проверяем что автор в друзьях
    // (для простоты просто перезагружаем ленту)
    if (typeof feedState !== 'undefined' && feedState.filter === 'friends') {
      if (typeof loadAllUsers === 'function') loadAllUsers();
      return;
    }

    const container = $('#feed-posts');
    if (!container) return;

    // Если это первый пост и лента пустая — перерисовываем всё
    if (!container.querySelector('.wall-post-card') && container.querySelector('.wall-empty')) {
      if (typeof loadAllUsers === 'function') loadAllUsers();
      return;
    }

    // Вставляем пост в начало ленты
    const html = typeof postCardHTML === 'function'
      ? postCardHTML(post, window.currentUserId)
      : '';
    if (html) {
      container.insertAdjacentHTML('afterbegin', html);
      // Анимация появления
      const firstPost = container.firstElementChild;
      if (firstPost) {
        firstPost.style.opacity = '0';
        firstPost.style.transform = 'translateY(-20px)';
        requestAnimationFrame(() => {
          firstPost.style.transition = 'opacity .4s ease, transform .4s ease';
          firstPost.style.opacity = '1';
          firstPost.style.transform = 'translateY(0)';
        });
      }
      // Обновляем превью комментариев
      if (typeof loadCommentsPreview === 'function') {
        const card = firstPost;
        if (card && post.comment_count > 0) loadCommentsPreview(card);
      }
    }

    // Уведомление
    const authorName = post.display_name || post.username;
    if (typeof notify === 'function') {
      notify(`📝 ${authorName} опубликовал пост`);
    }
  });
}

// === Inline обработчики (из dashboard.html) ===
document.getElementById('requests-header')?.addEventListener('click', () => {
  document.getElementById('requests-section').classList.toggle('expanded');
});
document.getElementById('find-friends-btn')?.addEventListener('click', () => {
  document.querySelector('[data-page=feed]')?.click();
});
document.getElementById('btn-delete-chat')?.addEventListener('click', () => {
  if (typeof confirmDeleteChat === 'function') confirmDeleteChat();
});
document.getElementById('btn-attach')?.addEventListener('click', () => {
  document.getElementById('message-file-input')?.click();
});
