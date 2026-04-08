/**
 * Друзья и заявки в друзья
 */

async function loadFriends() {
  try {
    const friends = await api('/api/friends');
    const c = $('#friends-list');
    if (!friends.length) {
      c.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg><p>Пока нет друзей</p><button class="btn btn-primary btn-small" id="go-to-feed-btn">Найти людей</button></div>';
      $('#go-to-feed-btn')?.addEventListener('click', () => navigateTo('people'));
      return;
    }
    c.innerHTML = friends.map(f => `<div class="list-item">${avatarHTML(f, 'small')}<div class="list-item-info"><a href="/${esc(f.username)}" class="list-item-name post-author-link" data-username="${esc(f.username)}">${esc(f.display_name || f.username)}</a><div class="list-item-username">@${esc(f.username)}</div></div><div class="list-item-actions"><button class="btn btn-small btn-add" data-action="message" data-id="${f.id}" data-name="${esc(f.display_name || f.username)}" data-avatar="${esc(f.avatar || '')}" data-username="${esc(f.username)}">Написать</button><button class="btn btn-small btn-reject" data-action="remove-friend" data-id="${f.id}">Удалить</button></div></div>`).join('');
  } catch (e) { console.error('loadFriends:', e); }
}

async function loadFriendRequests() {
  try {
    const r = await api('/api/friends/requests');
    const c = $('#friend-requests');
    const section = $('#requests-section');
    const badge = $('#requests-badge');
    const inline = $('#requests-inline-badge');

    if (!r.length) {
      section?.classList.remove('expanded');
      c.innerHTML = '<div class="request-empty">Нет заявок</div>';
      if (badge) badge.style.display = 'none';
      if (inline) inline.style.display = 'none';
      return;
    }

    if (badge) { badge.textContent = r.length; badge.style.display = 'inline'; }
    if (inline) { inline.textContent = r.length; inline.style.display = 'inline'; }
    section?.classList.add('expanded');

    c.innerHTML = r.map(x => `<div class="request-item">${avatarHTML(x, 'small')}<div><div class="request-name">${esc(x.display_name || x.username)}</div><div class="request-username">@${esc(x.username)}</div></div><div class="request-actions"><button class="btn btn-small btn-accept" data-action="accept-request" data-id="${x.friendship_id}">✓</button><button class="btn btn-small btn-reject" data-action="reject-request" data-id="${x.friendship_id}">✕</button></div></div>`).join('');
  } catch (e) { console.error('loadFriendRequests:', e); }
}

async function loadFriendRequestsCount() {
  try {
    const r = await api('/api/friends/requests');
    const badge = $('#requests-badge');
    const inline = $('#requests-inline-badge');
    const nav = $('#friend-requests-count');
    if (r.length > 0) {
      if (badge) { badge.textContent = r.length; badge.style.display = 'inline'; }
      if (inline) { inline.textContent = r.length; inline.style.display = 'inline'; }
      if (nav) { nav.textContent = r.length; nav.style.display = 'inline'; }
    } else {
      if (badge) badge.style.display = 'none';
      if (inline) inline.style.display = 'none';
      if (nav) nav.style.display = 'none';
    }
  } catch (e) { console.error('loadFriendRequestsCount:', e); }
}
