// Переключение вкладок
document.querySelectorAll('.auth-toggle__btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const newTab = btn.dataset.tab;

    document.querySelectorAll('.auth-toggle__btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.error-message').forEach(el => el.classList.remove('show'));

    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(`${newTab}-form`).classList.add('active');
  });
});

// Выровнять высоту wrapper по самой высокой форме
function syncFormHeights() {
  const wrapper = document.querySelector('.auth-forms-wrapper');
  const forms = document.querySelectorAll('.auth-form');
  let maxHeight = 0;

  forms.forEach(f => {
    // Временно показываем для замера
    f.style.display = 'block';
    const h = f.offsetHeight;
    if (h > maxHeight) maxHeight = h;
    f.style.display = '';
  });

  wrapper.style.minHeight = `${maxHeight}px`;
}

syncFormHeights();
window.addEventListener('resize', syncFormHeights);

// Показать / скрыть пароль
document.querySelectorAll('.toggle-password').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('input');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Скрыть пароль' : 'Показать пароль');

    // Меняем иконку: перечёркнутый глаз / глаз
    btn.innerHTML = isPassword
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  });
});

// Авторизация
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = e.target.querySelector('.btn-submit');

  errorEl.classList.remove('show');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Вход...</span>';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      errorEl.textContent = data.error;
      errorEl.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Войти</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      return;
    }

    window.location.href = '/dashboard.html';
  } catch (error) {
    errorEl.textContent = 'Ошибка подключения к серверу';
    errorEl.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Войти</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  }
});

// Регистрация
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const passwordConfirm = document.getElementById('register-password-confirm').value;
  const errorEl = document.getElementById('register-error');
  const submitBtn = e.target.querySelector('.btn-submit');

  errorEl.classList.remove('show');

  if (password !== passwordConfirm) {
    errorEl.textContent = 'Пароли не совпадают';
    errorEl.classList.add('show');
    return;
  }

  if (password.length < 8) {
    errorEl.textContent = 'Пароль должен быть не менее 8 символов';
    errorEl.classList.add('show');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Регистрация...</span>';

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      errorEl.textContent = data.error;
      errorEl.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Зарегистрироваться</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      return;
    }

    window.location.href = '/dashboard.html';
  } catch (error) {
    errorEl.textContent = 'Ошибка подключения к серверу';
    errorEl.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Зарегистрироваться</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  }
});

// Если уже авторизован — редирект на dashboard
(async () => {
  try {
    const res = await fetch('/api/profile', { credentials: 'include' });
    if (res.ok) window.location.href = '/dashboard.html';
  } catch {}
})();
