// Settings (#/settings): account sign-in, sync, offline copy, about. Full screen.

import { icons } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { confirmDialog, toast } from '../ui/overlay.js';
import { APP_VERSION } from '../version.js';
import {
  isConfigured, getSession, signIn, signUp, sendReset, signOut,
  inRecovery, cancelRecovery, setNewPassword, onAuthChange, MIN_PASSWORD,
} from '../sync/auth.js';
import { onStatus, describe, syncNow, resetSyncMemory, getStatus } from '../sync/engine.js';

export const fullscreen = true;

export function mount(root) {
  root.innerHTML = `
    <header class="settings-top">
      <span class="settings-top__side"></span>
      <h1 class="settings-top__title">Settings</h1>
      <span class="settings-top__side settings-top__side--right">
        <a class="icon-btn icon-btn--round" href="#/home" aria-label="Close settings">${icons.close}</a>
      </span>
    </header>
    <main class="settings-page">
      <h2 class="group-label">Your account</h2>
      <section class="group" data-account></section>

      <h2 class="group-label">Sync</h2>
      <section class="group" data-sync></section>

      <h2 class="group-label">Offline</h2>
      <section class="group" data-offline></section>

      <h2 class="group-label">About</h2>
      <section class="group">
        <div class="group__row">
          <span class="group__icon">${icons.heart}</span>
          <span class="group__text"><strong>Loopy Days</strong><span>Version ${esc(APP_VERSION.replace(/^loopy-days-/, ''))}</span></span>
        </div>
        <div class="group__row group__row--note">
          <p>A private app, made for its owner. Your knitting lives on your own devices and, once you sign in, in your own private online space. Nobody else can see it.</p>
        </div>
      </section>
    </main>`;

  const accountEl = root.querySelector('[data-account]');
  const syncEl = root.querySelector('[data-sync]');
  const offlineEl = root.querySelector('[data-offline]');
  let mode = '';
  let countdown = null;
  let busy = false;

  /* ---------------- account ---------------- */

  const currentMode = () => {
    if (!isConfigured()) return 'off';
    if (inRecovery()) return 'newpass';
    if (getSession()) return 'in';
    return 'signin';
  };

  function renderAccount(force = false) {
    const m = currentMode();
    if (m === mode && !force) { paintAccountStatus(); return; }
    mode = m;
    clearInterval(countdown); countdown = null;

    if (m === 'off') {
      accountEl.innerHTML = `
        <div class="group__row">
          <span class="group__icon">${icons.cloudOff}</span>
          <span class="group__text"><strong>Sync isn’t set up yet</strong>
            <span>Everything is saved on this device. Signing in becomes available once the online space is connected.</span></span>
        </div>`;
      return;
    }

    if (m === 'signin') {
      accountEl.innerHTML = `
        <form class="group__form" data-form="signin" novalidate>
          <p class="group__lead">Sign in to keep your iPhone and laptop in step. First time here? Type your email and a new password, then tap “Create my account”.</p>
          <label class="field">
            <span class="field__label">Email</span>
            <input class="input" name="email" type="email" inputmode="email" autocomplete="username"
              autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="you@example.com" required>
          </label>
          <label class="field">
            <span class="field__label">Password</span>
            <input class="input" name="password" type="password" autocomplete="current-password"
              minlength="${MIN_PASSWORD}" enterkeyhint="go" placeholder="At least ${MIN_PASSWORD} characters" required>
          </label>
          <p class="form-error" data-error hidden></p>
          <button class="btn btn--butter btn--block" type="submit">${icons.user}<span>Sign in</span></button>
          <div class="group__links">
            <button type="button" class="btn btn--text btn--small" data-create>Create my account</button>
            <button type="button" class="btn btn--text btn--small" data-forgot>Forgot password?</button>
          </div>
        </form>`;
      const f = accountEl.querySelector('form');
      const after = () => { toast('Signed in. Syncing your knitting…'); renderAccount(true); };
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        await withBusy(f.querySelector('button[type=submit]'), 'Signing in…', async () => {
          await signIn(f.email.value, f.password.value); after();
        }, f);
      });
      const create = f.querySelector('[data-create]');
      create.addEventListener('click', async () => {
        if (busy) return;
        f.password.setAttribute('autocomplete', 'new-password');
        await withBusy(create, 'Creating…', async () => {
          await signUp(f.email.value, f.password.value); after();
        }, f);
      });
      const forgot = f.querySelector('[data-forgot]');
      forgot.addEventListener('click', async () => {
        if (busy) return;
        await withBusy(forgot, 'Sending…', async () => {
          await sendReset(f.email.value);
          showError(f, '');
          toast('Check your email for a reset link', { ms: 4000 });
        }, f);
      });
      return;
    }

    if (m === 'newpass') {
      accountEl.innerHTML = `
        <form class="group__form" data-form="newpass" novalidate>
          <p class="group__lead">Choose a new password for Loopy Days.</p>
          <label class="field">
            <span class="field__label">New password</span>
            <input class="input" name="password" type="password" autocomplete="new-password"
              minlength="${MIN_PASSWORD}" enterkeyhint="done" placeholder="At least ${MIN_PASSWORD} characters" required>
          </label>
          <p class="form-error" data-error hidden></p>
          <button class="btn btn--butter btn--block" type="submit"><span>Save new password</span></button>
          <div class="group__links">
            <button type="button" class="btn btn--text btn--small" data-cancel>Cancel</button>
          </div>
        </form>`;
      const f = accountEl.querySelector('form');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        await withBusy(f.querySelector('button[type=submit]'), 'Saving…', async () => {
          await setNewPassword(f.password.value);
          accountEl.innerHTML = `
            <div class="group__row">
              <span class="group__icon">${icons.check}</span>
              <span class="group__text"><strong>Password changed</strong>
                <span>Now open Loopy Days from your home screen and sign in with your new password.</span></span>
            </div>`;
          mode = 'done';
        }, f);
      });
      f.querySelector('[data-cancel]').addEventListener('click', () => { cancelRecovery(); renderAccount(true); });
      return;
    }

    // signed in
    const s = getSession();
    accountEl.innerHTML = `
      <div class="group__row">
        <span class="group__icon">${icons.user}</span>
        <span class="group__text"><strong class="group__email">${esc(s.user && s.user.email || 'Signed in')}</strong>
          <span class="sync-line" data-account-status><span class="sync-dot"></span><span data-text></span></span></span>
      </div>
      <div class="group__row group__row--buttons">
        <button type="button" class="btn btn--secondary" data-sync-now>${icons.sync}<span>Sync now</span></button>
        <button type="button" class="btn btn--danger-soft" data-sign-out>${icons.signOut}<span>Sign out</span></button>
      </div>`;
    accountEl.querySelector('[data-sync-now]').addEventListener('click', runSyncNow);
    accountEl.querySelector('[data-sign-out]').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Sign out?',
        message: 'Your knitting stays on this device. Anything you change while signed out will sync the next time you sign in.',
        ok: 'Sign out',
        danger: true,
      });
      if (!ok) return;
      await signOut();
      resetSyncMemory();
      toast('Signed out. Everything is still on this device.');
      renderAccount(true);
    });
    paintAccountStatus();
  }

  function paintAccountStatus() {
    const line = accountEl.querySelector('[data-account-status]');
    if (!line) return;
    const d = describe(getStatus());
    line.dataset.tone = d.tone;
    line.querySelector('[data-text]').textContent = d.text;
  }

  async function runSyncNow() {
    const ok = await syncNow();
    if (ok) toast('All changes saved online');
  }

  function showError(form, msg) {
    const el = form.querySelector('[data-error]');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  async function withBusy(button, label, fn, form) {
    busy = true;
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span>${esc(label)}</span>`;
    showError(form, '');
    try {
      await fn();
    } catch (e) {
      if (!e.kind) console.error(e);
      if (button.isConnected) showError(form, e.message || 'Something went wrong. Please try again.');
    } finally {
      busy = false;
      if (button.isConnected) { button.disabled = false; button.innerHTML = old; }
    }
  }

  /* ---------------- sync ---------------- */

  function renderSync(s) {
    const d = describe(s);
    const details = [];
    if (s.state !== 'off' && s.state !== 'signed-out' && s.pending) details.push(`${s.pending} ${s.pending === 1 ? 'change' : 'changes'} on this device not sent yet`);
    syncEl.innerHTML = `
      <div class="group__row">
        <span class="group__icon">${d.tone === 'off' ? icons.cloudOff : icons.cloud}</span>
        <span class="group__text">
          <span class="sync-line" data-tone="${d.tone}"><span class="sync-dot"></span><strong>${esc(d.text)}</strong></span>
          ${details.map((x) => `<span>${esc(x)}</span>`).join('')}
          ${s.state === 'off' ? '<span>Your knitting is kept on this device only.</span>' : ''}
          ${s.state === 'signed-out' ? '<span>Sign in above to share your knitting between devices.</span>' : ''}
        </span>
        ${d.retry ? `<button type="button" class="btn btn--pink btn--small" data-retry>Try again</button>` : ''}
      </div>`;
    syncEl.querySelector('[data-retry]')?.addEventListener('click', runSyncNow);
  }

  /* ---------------- offline ---------------- */

  async function renderOffline() {
    let title = 'Offline copy not available';
    let text = 'This browser can’t keep a copy for use without signal.';
    let tone = 'off';
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      if (reg && reg.active) {
        title = 'Ready to use offline';
        text = 'Loopy Days opens and counts even with no signal at all.';
        tone = 'ok';
      } else {
        title = 'Getting the offline copy ready…';
        text = 'Keep the app open for a moment while it saves itself.';
        tone = 'busy';
      }
    }
    if (!root.isConnected) return;
    offlineEl.innerHTML = `
      <div class="group__row">
        <span class="group__icon">${icons.offline}</span>
        <span class="group__text">
          <span class="sync-line" data-tone="${tone}"><span class="sync-dot"></span><strong>${esc(title)}</strong></span>
          <span>${esc(text)}</span>
        </span>
      </div>
      <div class="group__row">
        <span class="group__icon">${icons.download}</span>
        <span class="group__text"><strong>Space used on this device</strong>
          <span data-usage>Working it out…</span></span>
      </div>
      <div class="group__row group__row--buttons group__row--one">
        <button type="button" class="btn btn--secondary" data-free>${icons.trash}<span>Remove downloaded files</span></button>
      </div>`;
    paintUsage();
  }

  const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);
  async function paintUsage() {
    const { localUsage } = await import('../sync/files.js');
    const u = await localUsage();
    const el2 = offlineEl.querySelector('[data-usage]');
    if (el2) el2.textContent = `${mb(u.bytes)} of photos and pattern PDFs. ${u.removable ? `${mb(u.removable)} of it is safely online and can be removed.` : 'Nothing to remove: everything here is needed or not online yet.'}`;
    const btn = offlineEl.querySelector('[data-free]');
    if (btn) btn.disabled = !u.removable;
  }
  offlineEl.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-free]')) return;
    const ok = await confirmDialog({
      title: 'Remove downloaded files?',
      message: 'Full-size photos and pattern PDFs that are safely online are removed from this device. Thumbnails and covers stay, and anything opens again from your online space when needed.',
      ok: 'Remove', cancel: 'Keep them',
    });
    if (!ok) return;
    const { removeDownloaded } = await import('../sync/files.js');
    const freed = await removeDownloaded();
    toast(`Freed ${mb(freed)}`);
    paintUsage();
  });

  renderAccount(true);
  const stopStatus = onStatus((s) => { renderSync(s); paintAccountStatus(); });
  const stopAuth = onAuthChange(() => renderAccount());
  renderOffline();
  const onCtl = () => renderOffline();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', onCtl);
    navigator.serviceWorker.ready.then(() => root.isConnected && renderOffline());
  }
  const ticker = setInterval(() => { renderSync(getStatus()); paintAccountStatus(); }, 30000);

  return () => {
    clearInterval(countdown);
    clearInterval(ticker);
    stopStatus();
    stopAuth();
    if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', onCtl);
  };
}
