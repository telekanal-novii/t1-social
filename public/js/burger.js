/**
 * Мобильное меню (бургер)
 */
(() => {
  const burger = document.getElementById('burger-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const closeBtn = document.getElementById('sidebar-close');

  function openMenu() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    burger.classList.add('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    burger.classList.remove('hidden');
    document.body.style.overflow = '';
  }

  burger?.addEventListener('click', openMenu);
  overlay?.addEventListener('click', closeMenu);
  closeBtn?.addEventListener('click', closeMenu);

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) closeMenu();
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) closeMenu();
  });
})();

// Кнопка "назад" из чата (мобильный мессенджер)
document.getElementById('chat-back-btn')?.addEventListener('click', () => {
  document.querySelector('.messenger-layout')?.classList.remove('chat-open');
});

// Свайп вправо для возврата к списку диалогов (только мобильный)
(() => {
  if (window.innerWidth > 768) return;

  let startX = 0;
  const chatPanel = document.getElementById('chat-panel');
  if (!chatPanel) return;

  chatPanel.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  }, { passive: true });

  chatPanel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (dx > 80 && startX < 50) {
      document.querySelector('.messenger-layout')?.classList.remove('chat-open');
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      document.querySelector('.messenger-layout')?.classList.remove('chat-open');
    }
  });
})();
