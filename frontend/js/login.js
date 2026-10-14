/**
 * login.js
 * ---------------------------------------------------------------------
 * Drives login.html: the "Sign in" and "Create account" forms. On
 * success the browser has already received the HttpOnly session cookie
 * (this script never sees or stores the session token); it then returns
 * the user to the page they came from, but only to one of this site's
 * own pages (AuthHelpers.safeNextTarget).
 */
(function () {
  const banner = document.getElementById('auth-error');
  const params = new URLSearchParams(window.location.search);
  const next = AuthHelpers.safeNextTarget(params.get('next'));

  function showError(message) {
    banner.textContent = message;
    banner.classList.add('visible');
  }

  function clearError() {
    banner.textContent = '';
    banner.classList.remove('visible');
  }

  function wire(formId, usernameId, passwordId, buttonId, call) {
    const form = document.getElementById(formId);
    const username = document.getElementById(usernameId);
    const password = document.getElementById(passwordId);
    const button = document.getElementById(buttonId);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError();
      button.disabled = true;
      const result = await call(username.value, password.value);
      if (result.success) {
        window.location.href = next;
        return;
      }
      button.disabled = false;
      password.value = '';
      showError((result.error && result.error.message) || 'Something went wrong. Please try again.');
    });
  }

  wire('login-form', 'login-username', 'login-password', 'login-submit', (u, p) => AuthAPI.login(u, p));
  wire('register-form', 'register-username', 'register-password', 'register-submit', (u, p) => AuthAPI.register(u, p));
})();
