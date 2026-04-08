/**
 * Навигация и SPA-роутинг
 */

const VALID_PAGES = ['feed', 'profile', 'friends', 'messages', 'people', 'music'];
let currentPage = null;

/**
 * Переключает страницу и обновляет URL
 * @param {string} page
 * @param {boolean} [pushState]
 */
function navigateTo(page, pushState = true) {
  // Не перезагружаем если уже на этой странице
  if (page === currentPage && pushState) return;
  currentPage = page;

  // КРИТИЧНО: сохраняем состояние музыкального плеера при навигации
  const musicPlaying = typeof audioEl !== 'undefined' && audioEl && !audioEl.paused;
  const musicSrc = typeof audioEl !== 'undefined' && audioEl ? audioEl.src : '';
  const musicTime = typeof audioEl !== 'undefined' && audioEl ? audioEl.currentTime : 0;

  $$('.nav-link').forEach(l => l.classList.remove('active'));
  const link = $(`.nav-link[data-page="${page}"]`);
  if (link) link.classList.add('active');

  $$('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`#${page}-page`);
  if (pageEl) pageEl.classList.add('active');

  // Профиль → URL на /username
  if (page === 'profile') {
    const username = window.currentUsername || '';
    if (pushState && username) {
      history.pushState({ page: 'user-profile', username }, '', `/${username}`);
    }
  } else if (pushState) {
    history.pushState({ page }, '', `/${page}`);
  }

  const loaders = {
    feed: loadAllUsers,
    people: loadPeople,
    friends: () => { loadFriends(); loadFriendRequests(); },
    messages: loadConversations,
    profile: loadProfile,
    music: () => { if (typeof loadMusic === 'function') loadMusic(); },
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

// ======================== НАСТРОЙКИ ========================

// Применение сохранённой темы
(function applySavedTheme() {
  const theme = localStorage.getItem('theme');
  if (theme && theme !== 'default') {
    document.documentElement.setAttribute('data-theme', theme);
  }
})();

// Открыть/закрыть
$('#settings-btn')?.addEventListener('click', () => {
  $('#settings-modal').style.display = 'flex';
  $$('.settings-error').forEach(el => el.style.display = 'none');
  $('#password-form')?.reset();
  // Обновить активную тему
  const current = localStorage.getItem('theme') || 'default';
  $$('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === current);
  });
});

$('#settings-close-btn')?.addEventListener('click', () => {
  $('#settings-modal').style.display = 'none';
});

$('#settings-modal')?.addEventListener('click', e => {
  if (e.target.id === 'settings-modal') $('#settings-modal').style.display = 'none';
});

// Табы
$$('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.settings-tab').forEach(t => t.classList.remove('active'));
    $$('.settings-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#settings-${tab.dataset.tab}`).classList.add('active');
  });
});

// Смена темы
$$('.theme-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const theme = opt.dataset.theme;
    $$('.theme-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');

    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    }

    notify(`Тема: ${opt.querySelector('span').textContent}`);
  });
});

// Смена пароля
$('#password-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = $('#password-error');
  errEl.style.display = 'none';

  const current = $('#current-password').value;
  const newPw = $('#new-password').value;
  const confirm = $('#confirm-password').value;

  if (newPw !== confirm) {
    errEl.textContent = 'Пароли не совпадают';
    errEl.style.display = 'block';
    return;
  }

  try {
    await api('/api/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: current, new_password: newPw })
    });
    notify('Пароль изменен');
    $('#password-form').reset();
    $('#settings-modal').style.display = 'none';
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка';
    errEl.style.display = 'block';
  }
});

// Удаление аккаунта
$('#delete-account-btn')?.addEventListener('click', async () => {
  if (!confirm('Вы уверены? Это действие нельзя отменить.')) return;
  if (!confirm('Точно удалить аккаунт? Все данные будут потеряны.')) return;

  const errEl = $('#delete-account-error');
  errEl.style.display = 'none';

  try {
    await api('/api/profile', { method: 'DELETE' });
    localStorage.clear();
    window.location.href = '/';
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка удаления';
    errEl.style.display = 'block';
  }
});

// Экспорт для dashboard.js
window.initNavigation = function() {
  const initPath = decodeURIComponent(window.location.pathname.slice(1));

  // Игнорируем файлы (dashboard.html и т.п.)
  if (initPath.includes('.')) {
    return navigateTo('feed', false);
  }

  const myUsername = window.currentUsername;

  // Валидация URL — только безопасные символы
  const safePath = /^[a-zA-Z0-9_-]+$/.test(initPath);

  if (!VALID_PAGES.includes(initPath) && initPath && safePath) {
    // Путь — это username
    if (myUsername && initPath === myUsername) {
      // Свой профиль — показываем страницу профиля
      $$('.nav-link').forEach(l => l.classList.remove('active'));
      const profileLink = $(`.nav-link[data-page="profile"]`);
      if (profileLink) profileLink.classList.add('active');
      $$('.page').forEach(p => p.classList.remove('active'));
      const profilePage = $('#profile-page');
      if (profilePage) profilePage.classList.add('active');
      history.replaceState({ page: 'user-profile', username: myUsername }, '', `/${myUsername}`);
      currentPage = 'profile';
      loadProfile();
    } else {
      // Чужой профиль
      window.openUserProfileByUsername(initPath);
    }
  } else {
    // Невалидный путь — редирект на ленту
    navigateTo(VALID_PAGES.includes(initPath) ? initPath : 'feed', false);
  }
};

// Закрытие модалок по Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.style.display === 'flex') settingsModal.style.display = 'none';
  }
});
