/**
 * Музыка — загрузка и прослушивание треков
 */

let musicTracks = [];
let currentTrack = null;
let audioEl = null;
let isPlaying = false;

/**
 * Инициализация глобального плеера
 */
function initGlobalPlayer() {
  if (audioEl) return;

  audioEl = new Audio();
  audioEl.volume = parseFloat(localStorage.getItem('musicVolume') || '1');
  const volSlider = $('#gp-volume');
  if (volSlider) volSlider.value = audioEl.volume;

  audioEl.addEventListener('timeupdate', updateProgress);
  audioEl.addEventListener('ended', playNext);
  audioEl.addEventListener('loadedmetadata', () => {
    const dur = Math.round(audioEl.duration);
    if (currentTrack) currentTrack.duration = dur;
    $('#gp-duration').textContent = formatDuration(dur);
  });
}

/**
 * Загружает список треков
 */
window.loadMusic = async function() {
  try {
    musicTracks = await api('/api/music');
    renderMusicTracks();
  } catch (e) {
    console.error('[music] loadMusic:', e);
  }
};

/**
 * Рендерит список треков
 */
function renderMusicTracks() {
  const list = $('#music-tracks-list');
  if (!list) return;

  if (!musicTracks.length) {
    list.innerHTML = `<div class="music-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
      </svg>
      <p>Пока нет треков</p>
      <p class="music-empty-hint">Загрузите первый трек, чтобы начать</p>
    </div>`;
    return;
  }

  list.innerHTML = musicTracks.map(t => {
    const isCurrent = currentTrack && currentTrack.id === t.id;
    const isOwner = t.user_id == userId;
    const displayName = t.title || t.original_name;
    const displayArtist = t.artist || (t.display_name || t.username);
    const duration = formatDuration(t.duration);

    return `<div class="music-track-item ${isCurrent && isPlaying ? 'playing' : ''}" data-track-id="${t.id}">
      <div class="music-track-info">
        <div class="music-track-icon">
          ${isCurrent && isPlaying
            ? `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;color:var(--primary)"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`}
        </div>
        <div class="music-track-details">
          <div class="music-track-title">${esc(displayName)}</div>
          <div class="music-track-artist">${esc(displayArtist)}</div>
        </div>
        <div class="music-track-duration">${duration}</div>
      </div>
      <div class="music-track-actions">
        <button class="music-play-btn" data-track-id="${t.id}" title="${isCurrent && isPlaying ? 'Пауза' : 'Воспроизвести'}">
          ${isCurrent && isPlaying
            ? `<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`
            : `<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><path d="M8 5v14l11-7z"/></svg>`}
        </button>
        ${isOwner ? `<button class="music-delete-btn" data-track-id="${t.id}" title="Удалить">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/**
 * Воспроизводит трек
 */
window.playTrack = function(trackId) {
  initGlobalPlayer();

  const track = musicTracks.find(t => t.id === trackId);
  if (!track) return;

  // Пауза если тот же трек
  if (currentTrack && currentTrack.id === trackId) {
    if (isPlaying) {
      audioEl.pause();
      isPlaying = false;
    } else {
      audioEl.play().catch(() => {});
      isPlaying = true;
    }
    updatePlayerUI();
    renderMusicTracks();
    return;
  }

  currentTrack = track;
  audioEl.src = `/media/music/${track.filename}`;
  audioEl.play().catch(() => {});
  isPlaying = true;

  // Показать глобальный плеер
  const player = $('#global-music-player');
  if (player) player.style.display = 'flex';

  updatePlayerUI();
  renderMusicTracks();
};

/**
 * Следующий трек
 */
function playNext() {
  if (!currentTrack || !musicTracks.length) {
    isPlaying = false;
    updatePlayerUI();
    renderMusicTracks();
    return;
  }
  const idx = musicTracks.findIndex(t => t.id === currentTrack.id);
  if (idx >= 0 && idx < musicTracks.length - 1) {
    playTrack(musicTracks[idx + 1].id);
  } else {
    isPlaying = false;
    updatePlayerUI();
    renderMusicTracks();
  }
}

/**
 * Предыдущий трек
 */
function playPrev() {
  if (!currentTrack || !musicTracks.length) return;
  const idx = musicTracks.findIndex(t => t.id === currentTrack.id);
  if (idx > 0) {
    playTrack(musicTracks[idx - 1].id);
  } else {
    // В начало трека
    if (audioEl) {
      audioEl.currentTime = 0;
    }
  }
}

/**
 * Обновляет UI глобального плеера
 */
function updatePlayerUI() {
  if (!currentTrack) return;

  const title = $('#gp-title');
  const artist = $('#gp-artist');
  const playIcon = $('#gp-play-icon');

  if (title) title.textContent = currentTrack.title || currentTrack.original_name;
  if (artist) artist.textContent = currentTrack.artist || (currentTrack.display_name || currentTrack.username);

  if (playIcon) {
    playIcon.innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>'
      : '<path d="M8 5v14l11-7z"/>';
  }

  if (currentTrack.duration) {
    const dur = $('#gp-duration');
    if (dur) dur.textContent = formatDuration(currentTrack.duration);
  }
}

/**
 * Обновляет прогресс-бар
 */
function updateProgress() {
  if (!audioEl || !audioEl.duration) return;

  const pct = (audioEl.currentTime / audioEl.duration) * 100;
  const bar = $('#gp-progress');
  if (bar) bar.style.width = `${pct}%`;

  const cur = $('#gp-current');
  if (cur) cur.textContent = formatDuration(Math.round(audioEl.currentTime));
}

/**
 * Форматирует длительность
 */
function formatDuration(sec) {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Загрузка трека
 */
window.uploadMusic = async function(file, title, artist) {
  // Получаем длительность до загрузки
  const tempAudio = new Audio(URL.createObjectURL(file));
  const duration = await new Promise(resolve => {
    tempAudio.addEventListener('loadedmetadata', () => resolve(Math.round(tempAudio.duration)));
    tempAudio.addEventListener('error', () => resolve(0));
  });

  const fd = new FormData();
  fd.append('audio', file);
  fd.append('duration', duration);
  if (title) fd.append('title', title);
  if (artist) fd.append('artist', artist);

  const res = await fetch('/api/music/upload', {
    method: 'POST',
    credentials: 'include',
    body: fd
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Ошибка загрузки');
  }
  notify('Трек загружен');
  await loadMusic();
};

/**
 * Удаление трека
 */
window.deleteMusicTrack = async function(trackId) {
  if (!confirm('Удалить этот трек?')) return;
  try {
    await api(`/api/music/${trackId}`, { method: 'DELETE' });
    if (currentTrack && currentTrack.id === trackId) {
      if (audioEl) audioEl.pause();
      audioEl = null;
      currentTrack = null;
      isPlaying = false;
      const player = $('#global-music-player');
      if (player) player.style.display = 'none';
    }
    notify('Трек удален');
    await loadMusic();
  } catch (e) {
    notify('Ошибка: ' + e.message, 'error');
  }
};

// ======================== Обработчики ========================

// Показать/скрыть форму загрузки
$('#upload-music-btn')?.addEventListener('click', () => {
  const form = $('#music-upload-form');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

$('#cancel-music-upload')?.addEventListener('click', () => {
  const form = $('#music-upload-form');
  if (form) form.style.display = 'none';
  $('#music-upload')?.reset();
  const err = $('#music-upload-error');
  if (err) err.style.display = 'none';
});

// Загрузка формы
$('#music-upload')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = $('#music-upload-error');
  if (errEl) errEl.style.display = 'none';

  const file = $('#music-file')?.files?.[0];
  if (!file) return;

  const title = $('#music-title')?.value.trim() || '';
  const artist = $('#music-artist')?.value.trim() || '';

  const btn = e.target.querySelector('.music-upload-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }

  try {
    await uploadMusic(file, title, artist);
    $('#music-upload')?.reset();
    const form = $('#music-upload-form');
    if (form) form.style.display = 'none';
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:18px;height:18px"><polyline points="20 6 9 17 4 12"></polyline></svg> Загрузить';
    }
  }
});

// Кнопки глобального плеера
$('#gp-play')?.addEventListener('click', () => {
  if (!currentTrack) return;
  if (isPlaying) {
    audioEl.pause();
    isPlaying = false;
  } else {
    audioEl.play().catch(() => {});
    isPlaying = true;
  }
  updatePlayerUI();
  renderMusicTracks();
});

$('#gp-prev')?.addEventListener('click', playPrev);
$('#gp-next')?.addEventListener('click', playNext);

// Громкость
$('#gp-volume')?.addEventListener('input', e => {
  if (audioEl) {
    audioEl.volume = parseFloat(e.target.value);
    localStorage.setItem('musicVolume', e.target.value);
  }
});

// Прогресс-бар: клик для перемотки
$('#gp-progress-wrap')?.addEventListener('click', e => {
  if (!audioEl || !audioEl.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audioEl.currentTime = pct * audioEl.duration;
});

// Делегирование: play / delete в списке треков
document.addEventListener('click', e => {
  const playBtn = e.target.closest('.music-play-btn');
  if (playBtn) {
    playTrack(parseInt(playBtn.dataset.trackId));
    return;
  }
  const deleteBtn = e.target.closest('.music-delete-btn');
  if (deleteBtn) {
    deleteMusicTrack(parseInt(deleteBtn.dataset.trackId));
    return;
  }
});
