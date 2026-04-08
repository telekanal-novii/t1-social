// Переключение вкладок
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
  });
});

// Авторизация
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

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
      return;
    }

    // Токен теперь в httpOnly cookie — не храним в localStorage
    window.location.href = '/dashboard.html';
  } catch (error) {
    errorEl.textContent = 'Ошибка подключения к серверу';
    errorEl.classList.add('show');
  }
});

// Регистрация
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  const passwordConfirm = document.getElementById('register-password-confirm').value;
  const errorEl = document.getElementById('register-error');

  if (password !== passwordConfirm) {
    errorEl.textContent = 'Пароли не совпадают';
    errorEl.classList.add('show');
    return;
  }

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
      return;
    }

    // Токен теперь в httpOnly cookie — не храним в localStorage
    window.location.href = '/dashboard.html';
  } catch (error) {
    errorEl.textContent = 'Ошибка подключения к серверу';
    errorEl.classList.add('show');
  }
});
