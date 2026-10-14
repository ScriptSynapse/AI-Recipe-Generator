/** settings.js -- shows the signed-in account (display only) and signs out. */
(function () {
  const $ = (id) => document.getElementById(id);
  function wirePasswordForm() {
    const error = (msg) => { $('pw-error').textContent = msg; };
    $('pw-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      error(''); $('set-status').textContent = '';
      const current = $('pw-current').value;
      const next = $('pw-new').value;
      // Convenience checks only -- the server decides what is acceptable.
      if (!current) { error('Enter your current password.'); return; }
      if (next.length < 10) { error('The new password must be at least 10 characters.'); return; }
      if (next !== $('pw-confirm').value) { error('The two new passwords do not match.'); return; }
      $('pw-submit').disabled = true;
      try {
        const result = await AuthAPI.changePassword(current, next);
        if (result && result.success) {
          ['pw-current', 'pw-new', 'pw-confirm'].forEach((id) => { $(id).value = ''; });
          $('set-status').textContent = 'Password changed. Other devices have been signed out.';
        } else if (result && result.error && result.error.code === 'AUTH_REQUIRED') {
          window.location.href = AuthHelpers.loginUrlFor('settings.html');
        } else {
          error((result && result.error && result.error.message) || 'Could not change the password.');
        }
      } finally { $('pw-submit').disabled = false; }
    });
  }

  async function init() {
    const me = await AuthAPI.me();
    if (!me || !me.success || !me.data || !me.data.user) {
      $('set-signin-link').href = AuthHelpers.loginUrlFor('settings.html');
      $('set-signin').classList.remove('hidden');
      return;
    }
    $('set-username').textContent = me.data.user.username;
    $('set-role').textContent = me.data.user.role === 'ADMIN' ? 'Administrator' : 'User';
    $('set-main').classList.remove('hidden');
    $('set-password').classList.remove('hidden');
    wirePasswordForm();
    $('set-signout').addEventListener('click', async () => {
      $('set-signout').disabled = true;
      await AuthAPI.logout();
      window.location.href = 'index.html';
    });
  }
  init();
})();
