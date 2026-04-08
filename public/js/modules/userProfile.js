/**
 * Просмотр профиля другого пользователя
 */

/**
 * Открывает профиль пользователя по username
 * @param {string} username
 */
window.openUserProfileByUsername = async function(username) {
  try {
    const decoded = decodeURIComponent(username);

    // Проверяем — не свой ли это профиль
    try {
      const myProfile = await api('/api/profile');
      if (decoded === myProfile.username) {
        history.replaceState({ page: 'profile' }, '', '/profile');
        return navigateTo('profile');
      }
    } catch (e) {
      console.warn('[userProfile] decodeURIComponent error:', e);
    }

    const users = await api('/api/users');
    const user = users.find(u => u.username === decoded);
    if (!user) return notify('Пользователь не найден', 'error'), navigateTo('feed');

    const profile = await api(`/api/users/${user.id}`);
    renderUserProfile(profile);
  } catch (err) { notify('Ошибка: ' + err.message, 'error'); }
};

/**
 * Рендерит страницу чужого профиля
 * @param {Object} profile
 */
async function renderUserProfile(profile) {
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const show = (id, val) => { const el = $(id); if (el) el.style.display = val ? (el.tagName === 'IMG' ? 'block' : 'flex') : 'none'; };

  // КРИТИЧНО: сохраняем состояние музыкального плеера
  const musicPlaying = typeof audioEl !== 'undefined' && audioEl && !audioEl.paused;

  // Переключаем на страницу профиля
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#user-profile-page')?.classList.add('active');
  history.pushState({ page: 'user-profile', username: profile.username }, '', `/${profile.username}`);

  // Инфо
  set('#other-profile-username', '@' + profile.username);
  set('#other-profile-displayname', profile.display_name || 'Не указано');
  set('#other-profile-bio', profile.bio || '');

  // Аватар профиля
  if (profile.avatar) {
    $('#other-profile-avatar').src = profile.avatar; show('#other-profile-avatar', true);
    show('#other-profile-avatar-placeholder', false);
  } else {
    show('#other-profile-avatar', false); show('#other-profile-avatar-placeholder', true);
  }

  // Аватар для формы поста (мой, не его)
  try {
    const me = await api('/api/profile');
    if (me.avatar) {
      $('#other-post-form-avatar').src = me.avatar; show('#other-post-form-avatar', true);
      show('#other-post-form-avatar-placeholder', false);
    } else { show('#other-post-form-avatar', false); show('#other-post-form-avatar-placeholder', true); }
  } catch (e) {
    console.error('[userProfile] Ошибка загрузки профиля для поста:', e);
  }
  state.otherUserId = profile.id;

  // Кнопки действий
  let btns = '';
  try {
    const statuses = await api('/api/friends/statuses');
    const s = statuses[profile.id];
    if (!s) btns = `<button class="btn btn-primary btn-modern" data-action="add-friend" data-id="${profile.id}">Добавить в друзья</button>`;
    else if (s.status === 'pending' && s.direction === 'sent') btns = `<button class="btn btn-secondary btn-modern" disabled>✓ Заявка отправлена</button>`;
    else if (s.status === 'pending' && s.direction === 'received') btns = `<button class="btn btn-primary btn-modern" data-action="accept-from-profile" data-id="${profile.id}" data-name="${esc(profile.display_name || profile.username)}" data-avatar="${esc(profile.avatar || '')}">Принять заявку</button>`;
    else if (s.status === 'accepted') btns = `<button class="btn btn-danger btn-modern" data-action="remove-friend-main" data-id="${profile.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg><span>Удалить</span></button>`;
  } catch (e) {
    console.error('[userProfile] Ошибка загрузки статусов дружбы:', e);
  }
  btns += `<button class="btn btn-secondary btn-modern" data-action="message" data-id="${profile.id}" data-name="${esc(profile.display_name || profile.username)}" data-avatar="${esc(profile.avatar || '')}" data-username="${esc(profile.username)}">Написать сообщение</button>`;
  $('#other-profile-actions').innerHTML = btns;

  // Сброс табов
  $$('.profile-tab[data-otab]').forEach(t => t.classList.remove('active'));
  $('[data-otab="info"]')?.classList.add('active');
  $$('.otab-pane').forEach(p => p.classList.remove('active'));
  $('#otab-info')?.classList.add('active');

  // Загружаем стену
  loadWall(profile.id, 'other-wall-posts');
}

// Табы чужого профиля
document.addEventListener('click', e => {
  const tab = e.target.closest('.profile-tab[data-otab]');
  if (!tab) return;
  $$('.profile-tab[data-otab]').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  $$('.otab-pane').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('otab-' + tab.dataset.otab);
  if (target) target.classList.add('active');
});

// Публикация на чужой стене
$('#other-publish-post-btn')?.addEventListener('click', () => {
  if (!state.otherUserId) return notify('Ошибка', 'error');
  publishPost(state.otherUserId, 'other-post-content', 'other-char-count', 'other-wall-posts');
});
