/**
 * Навигация и SPA-роутинг
 */

const VALID_PAGES = ['feed', 'profile', 'friends', 'messages', 'people'];

/**
 * Переключает страницу и обновляет URL
 * @param {string} page
 * @param {boolean} [pushState]
 */
function navigateTo(page, pushState = true) {
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  const link = $(`.nav-link[data-page="${page}"]`);
  if (link) link.classList.add('active');

  $$('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`#${page}-page`);
  if (pageEl) pageEl.classList.add('active');

  if (pushState) history.pushState({ page }, '', `/${page}`);

  const loaders = {
    feed: loadAllUsers,
    people: loadPeople,
    friends: () => { loadFriends(); loadFriendRequests(); },
    messages: loadConversations,
    profile: loadProfile,
  };
  loaders[page]?.();
}

// Клик по навигации
$$('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.dataset.page);
  });
});

// Кнопки браузера
window.addEventListener('popstate', e => {
  if (e.state?.page === 'user-profile') {
    window.openUserProfileByUsername(e.state.username);
  } else {
    navigateTo(e.state?.page || 'feed', false);
  }
});

// Выход
$('#logout-btn')?.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {
    console.error('[logout] Ошибка при выходе:', e);
  }
  localStorage.clear(); // чистим только likedPosts и прочий кэш
  window.location.href = '/';
});

// Кнопка «Назад»
$('#back-to-feed')?.addEventListener('click', () => navigateTo('feed'));

// Экспорт для dashboard.js
window.initNavigation = function() {
  const initPath = decodeURIComponent(window.location.pathname.slice(1));
  if (!VALID_PAGES.includes(initPath) && initPath && !initPath.includes('/')) {
    (async () => {
      try {
        const myProfile = await api('/api/profile');
        if (initPath === myProfile.username) {
          history.replaceState({ page: 'profile' }, '', '/profile');
          navigateTo('profile', false);
        } else {
          window.openUserProfileByUsername(initPath);
        }
      } catch {
        navigateTo('feed', false);
      }
    })();
  } else {
    navigateTo(VALID_PAGES.includes(initPath) ? initPath : 'feed', false);
  }
};
