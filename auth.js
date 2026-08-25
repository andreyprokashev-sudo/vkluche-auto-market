(function () {
  const modal = document.querySelector('#authModal');
  const message = document.querySelector('#authMessage');
  const config = window.SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.anonKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.anonKey) : null;
  let user = null;
  let role = 'user';
  let accountType = 'private';
  let pendingAction = null;
  const accountTypeLabels = { private: 'Частное лицо', professional: 'Профессиональный участник' };
  const triggers = () => document.querySelectorAll('.auth-trigger');

  function showMessage(text = '', type = '') { message.textContent = text; message.className = `auth-message${type ? ` ${type}` : ''}`; }
  function showView(name) { document.querySelectorAll('.auth-view').forEach(view => view.classList.toggle('active', view.dataset.authView === name)); modal.querySelector('.auth-card').classList.toggle('dashboard-open',name==='profile');if(name==='profile')window.dispatchEvent(new CustomEvent('vkluche:dashboard-open'));showMessage(); }
  function open(view) { showView(view || (user ? 'profile' : configured ? 'login' : 'setup')); modal.classList.add('open'); document.body.style.overflow = 'hidden'; setTimeout(() => modal.querySelector('.auth-view.active input')?.focus(), 50); }
  function close() { modal.classList.remove('open'); document.body.style.overflow = document.querySelector('.detail.open') ? 'hidden' : ''; }
  function updateUi() {
    const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Пользователь';
    triggers().forEach(button => { if (button.classList.contains('profile-trigger')) { button.innerHTML = `<span class="profile-trigger-avatar">${user ? name.trim().charAt(0).toUpperCase() : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/></svg>'}</span>`; button.title = user ? name : 'Войти'; button.setAttribute('aria-label', user ? `Профиль: ${name}` : 'Войти'); } else button.textContent = user ? name : 'Войти'; button.classList.toggle('authenticated', Boolean(user)); });
    if (!user) return;
    document.querySelector('#profileName').textContent = name;
    document.querySelector('#profileEmail').textContent = user.email || '';
    document.querySelector('#profileRole').textContent = role === 'admin' ? `Администратор · ${accountTypeLabels[accountType] || 'Частное лицо'}` : accountTypeLabels[accountType] || 'Частное лицо';
    document.querySelector('#profileAvatar').textContent = name.trim().charAt(0).toUpperCase() || 'В';
  }
  async function syncProfile() { if (!client || !user) { role = 'user'; accountType = 'private'; return; } const { data } = await client.from('profiles').select('role,account_type').eq('id', user.id).maybeSingle(); role = data?.role || (user.user_metadata?.role === 'admin' ? 'admin' : 'user'); accountType = data?.account_type || user.user_metadata?.account_type || 'private'; updateUi(); window.dispatchEvent(new CustomEvent('vkluche:profile', { detail: { user, role, accountType } })); }
  function friendlyError(error) {
    const value = error?.message || 'Не удалось выполнить операцию';
    if (/invalid login credentials/i.test(value)) return 'Неверная почта или пароль.';
    if (/user already registered/i.test(value)) return 'Аккаунт с такой почтой уже существует.';
    if (/email not confirmed/i.test(value)) return 'Сначала подтвердите почту по ссылке из письма.';
    if (/password/i.test(value) && /least/i.test(value)) return 'Пароль слишком короткий.';
    return value;
  }
  async function submit(button, operation) {
    const original = button.textContent; button.disabled = true; button.textContent = 'Подождите…'; showMessage();
    try { await operation(); } catch (error) { showMessage(friendlyError(error), 'error'); }
    finally { button.disabled = false; button.textContent = original; }
  }

  triggers().forEach(button => button.addEventListener('click', () => open()));
  document.querySelectorAll('[data-auth-close]').forEach(button => button.addEventListener('click', close));
  document.querySelectorAll('[data-auth-switch]').forEach(button => button.addEventListener('click', () => showView(button.dataset.authSwitch)));
  document.querySelector('#loginForm').addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    submit(event.submitter, async () => { const { data, error } = await client.auth.signInWithPassword({ email: form.get('email').trim(), password: form.get('password') }); if (error) throw error; user = data.user; await syncProfile(); close(); window.dispatchEvent(new CustomEvent('vkluche:auth', { detail: { user, role } })); if (pendingAction) { const action = pendingAction; pendingAction = null; action(); } });
  });
  document.querySelector('#registerForm').addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    submit(event.submitter, async () => { const consentedAt=new Date().toISOString(),metadata={name:form.get('name').trim(),account_type:form.get('accountType'),terms_consent:true,terms_version:'2026-08-25',personal_data_consent:true,personal_data_version:'2026-08-25',privacy_acknowledged:true,privacy_version:'2026-08-25',email_notifications_consent:form.get('emailConsent')==='on',marketing_consent:form.get('marketingConsent')==='on',consented_at:consentedAt};const { data, error } = await client.auth.signUp({ email: form.get('email').trim(), password: form.get('password'), options: { data: metadata, emailRedirectTo: `${location.origin}${location.pathname}` } }); if (error) throw error; if (data.session) { user = data.user; await syncProfile(); close(); } else { showView('login'); showMessage('Регистрация завершена. Подтвердите почту по ссылке из письма.', 'success'); } });
  });
  document.querySelector('#resetForm').addEventListener('submit', event => {
    event.preventDefault(); const email = new FormData(event.currentTarget).get('email').trim();
    submit(event.submitter, async () => { const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` }); if (error) throw error; showMessage('Ссылка для восстановления отправлена. Проверьте почту.', 'success'); });
  });
  document.querySelector('#newPasswordForm').addEventListener('submit', event => {
    event.preventDefault(); const password = new FormData(event.currentTarget).get('password');
    submit(event.submitter, async () => { const { error } = await client.auth.updateUser({ password }); if (error) throw error; showView('profile'); showMessage('Пароль успешно изменён.', 'success'); });
  });
  document.querySelector('#logoutButton').addEventListener('click', async () => { const { error } = await client.auth.signOut(); if (error) return showMessage(friendlyError(error), 'error'); user = null; updateUi(); close(); window.dispatchEvent(new CustomEvent('vkluche:auth', { detail: { user: null } })); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) close(); });
  window.vklucheAuth = { isConfigured: configured, getUser: () => user, getRole: () => role, getAccountType: () => accountType, refreshProfile: syncProfile, getClient: () => client, open, require(action) { if (user) return true; pendingAction = typeof action === 'function' ? action : null; open(configured ? 'login' : 'setup'); return false; } };
  if (client) { client.auth.getSession().then(async ({ data }) => { user = data.session?.user || null; await syncProfile(); updateUi(); }); client.auth.onAuthStateChange((event, session) => { user = session?.user || null; if (!user) { role = 'user'; accountType = 'private'; } updateUi(); if (event === 'PASSWORD_RECOVERY') open('new-password'); }); } else updateUi();
})();
