/**
 * auth-status.js
 * ---------------------------------------------------------------------
 * Fills the #auth-nav slot in the site header: "Sign in" when logged
 * out, "<username> · Sign out" when logged in. The static "Sign in" link
 * in the HTML is the fallback until (or if) this runs.
 *
 * This is DISPLAY only. Whether the user may actually do anything is
 * decided by the server on every request; nothing here grants access.
 * All content is added with textContent / DOM nodes, never as HTML.
 */
(function () {
  const slot = document.getElementById('auth-nav');
  if (!slot) return;

  const currentPage = (window.location.pathname.split('/').pop() || 'index.html');

  function renderSignedOut() {
    slot.textContent = '';
    const link = document.createElement('a');
    link.href = AuthHelpers.loginUrlFor(currentPage);
    link.textContent = 'Sign in';
    slot.appendChild(link);
  }

  function renderSignedIn(user) {
    slot.textContent = '';

    if (user.role === 'ADMIN') {                // display only: the server enforces access
      document.querySelectorAll('.admin-only').forEach((item) => item.classList.remove('hidden'));
    }

    const name = document.createElement('span');
    name.className = 'auth-user';
    name.textContent = user.username;          // text, never HTML
    slot.appendChild(name);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost auth-signout';
    button.textContent = 'Sign out';
    button.addEventListener('click', async () => {
      button.disabled = true;
      await AuthAPI.logout();
      window.location.href = 'index.html';
    });
    slot.appendChild(button);
  }

  AuthAPI.me().then((result) => {
    if (result && result.success && result.data && result.data.user) renderSignedIn(result.data.user);
    else renderSignedOut();
  });
})();
