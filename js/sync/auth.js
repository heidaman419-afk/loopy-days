// Email + password sign-in with Supabase Auth, using fetch() only.
// The session lives in localStorage on this device only (it never syncs).

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const SESSION_KEY = 'ld-auth';

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);
const base = () => SUPABASE_URL.replace(/\/+$/, '');

/** Errors with a short, friendly message for the screen. kind: 'network' | 'rejected' | 'private' | 'input' | 'rate' | 'server' */
export class SyncError extends Error {
  constructor(kind, message, status = 0) { super(message); this.kind = kind; this.status = status; }
}

const listeners = new Set();
export const onAuthChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) try { fn(getSession()); } catch (e) { console.error(e); } };

/* ---------- session storage ---------- */

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function saveSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  emit();
}
export function forgetSession() {
  localStorage.removeItem(SESSION_KEY);
  emit();
}

function fromTokenResponse(j, fallbackEmail) {
  const now = Date.now();
  const expiresAt = j.expires_at ? j.expires_at * 1000 : now + (j.expires_in || 3600) * 1000;
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: expiresAt,
    user: { id: j.user && j.user.id, email: (j.user && j.user.email) || fallbackEmail || '' },
  };
}

/* ---------- raw calls ---------- */

async function authPost(path, body, token) {
  let res;
  try {
    res = await fetch(base() + path, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new SyncError('network', 'No connection. Try again when you’re online.');
  }
  let j = {};
  try { j = await res.json(); } catch { /* empty body */ }
  return { res, j };
}

const errText = (j) => [j.error_code, j.code, j.msg, j.message, j.error, j.error_description]
  .filter((x) => typeof x === 'string').join(' ').toLowerCase();

/* ---------- sign in (email + password) ---------- */

const RECOVERY_KEY = 'ld-auth-recovery';
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
export const MIN_PASSWORD = 8;

function checkInputs(email, password) {
  if (!okEmail(email)) throw new SyncError('input', 'That email doesn’t look quite right.');
  if (String(password || '').length < MIN_PASSWORD) throw new SyncError('input', `Passwords need at least ${MIN_PASSWORD} characters.`);
}

export async function signIn(email, password) {
  email = cleanEmail(email);
  checkInputs(email, password);
  const { res, j } = await authPost('/auth/v1/token?grant_type=password', { email, password });
  if (!res.ok || !j.access_token) {
    if (res.status === 429) throw new SyncError('rate', 'Too many tries. Please wait a minute.', res.status);
    if (res.status >= 500) throw new SyncError('server', 'Couldn’t reach your online space just now. Please try again.', res.status);
    throw new SyncError('input', 'That email and password don’t match. Check them, or use “Forgot password?”.', res.status);
  }
  saveSession(fromTokenResponse(j, email));
  return getSession();
}

export async function signUp(email, password) {
  email = cleanEmail(email);
  checkInputs(email, password);
  const { res, j } = await authPost('/auth/v1/signup', { email, password });
  if (!res.ok) {
    const t = errText(j);
    if (/signup|sign-up|sign up|not allowed|disabled/.test(t)) {
      throw new SyncError('private', 'This Loopy Days is private, so new accounts can’t be made.', res.status);
    }
    if (/already|registered|exists/.test(t)) {
      throw new SyncError('input', 'There’s already an account with that email. Use “Sign in” instead.', res.status);
    }
    if (/weak|password/.test(t)) throw new SyncError('input', 'Please choose a longer or less common password.', res.status);
    if (res.status === 429) throw new SyncError('rate', 'Too many tries. Please wait a minute.', res.status);
    throw new SyncError('server', 'Couldn’t create the account just now. Please try again.', res.status);
  }
  if (!j.access_token) {
    throw new SyncError('server', 'Account made, but it needs confirming by email first. Turn off “Confirm email” in Supabase, or confirm and then sign in.');
  }
  saveSession(fromTokenResponse(j, email));
  return getSession();
}

/** Email a password-reset link. The link opens this app in Safari, where a new password is chosen. */
export async function sendReset(email) {
  email = cleanEmail(email);
  if (!okEmail(email)) throw new SyncError('input', 'Type your email first, then tap “Forgot password?”.');
  const back = location.origin + location.pathname;
  const { res } = await authPost(`/auth/v1/recover?redirect_to=${encodeURIComponent(back)}`, { email });
  if (res.status === 429) throw new SyncError('rate', 'Please wait a minute before asking again.', res.status);
  if (!res.ok) throw new SyncError('server', 'Couldn’t send the email just now. Please try again.', res.status);
}

/** Called at start-up: if the page was opened from a reset email, keep its one-time session aside. */
export function catchRecoveryLink() {
  const h = location.hash || '';
  if (!/access_token=/.test(h) || !/type=recovery/.test(h)) return false;
  const q = new URLSearchParams(h.replace(/^#/, ''));
  sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(fromTokenResponse({
    access_token: q.get('access_token'), refresh_token: q.get('refresh_token'),
    expires_in: Number(q.get('expires_in')) || 3600,
  })));
  history.replaceState(null, '', location.pathname + '#/settings');
  return true;
}
export const inRecovery = () => !!sessionStorage.getItem(RECOVERY_KEY);
export const cancelRecovery = () => sessionStorage.removeItem(RECOVERY_KEY);

export async function setNewPassword(password) {
  if (String(password || '').length < MIN_PASSWORD) throw new SyncError('input', `Passwords need at least ${MIN_PASSWORD} characters.`);
  const rec = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) || 'null');
  if (!rec) throw new SyncError('input', 'This reset link has been used. Ask for a new one.');
  let res;
  try {
    res = await fetch(base() + '/auth/v1/user', {
      method: 'PUT',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${rec.access_token}` },
      body: JSON.stringify({ password }),
    });
  } catch { throw new SyncError('network', 'No connection. Try again when you’re online.'); }
  if (!res.ok) {
    let j = {}; try { j = await res.json(); } catch {}
    if (/same|different/.test(errText(j))) throw new SyncError('input', 'Choose a password different from the old one.');
    if (res.status === 401 || res.status === 403) { cancelRecovery(); throw new SyncError('input', 'This reset link has run out. Ask for a new one.'); }
    throw new SyncError('server', 'Couldn’t change the password just now. Please try again.', res.status);
  }
  cancelRecovery();
}

/* ---------- tokens ---------- */

let refreshing = null;

/** Swap the refresh token for a new pair. Only one refresh runs at a time (tokens rotate). */
export function refreshSession() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const s = getSession();
    if (!s || !s.refresh_token) throw new SyncError('rejected', 'Please sign in again.');
    const { res, j } = await authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    if (res.ok && j.access_token) {
      const next = fromTokenResponse(j, s.user && s.user.email);
      if (!next.user.id) next.user = s.user;
      saveSession(next);
      return next;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // The server definitely refused this session: forget it (local data stays).
      forgetSession();
      throw new SyncError('rejected', 'You were signed out. Please sign in again.', res.status);
    }
    throw new SyncError('server', 'The server is having a moment. Will try again soon.', res.status);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** A valid access token, refreshed a minute before it runs out. */
export async function accessToken() {
  const s = getSession();
  if (!s) throw new SyncError('rejected', 'Not signed in.');
  if (Date.now() > s.expires_at - 60000) return (await refreshSession()).access_token;
  return s.access_token;
}

/** fetch() to the Supabase REST API with the right headers; refreshes once on 401. */
export async function apiFetch(path, init = {}) {
  const go = async (token) => {
    try {
      return await fetch(base() + path, {
        ...init,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
    } catch {
      throw new SyncError('network', 'No connection.');
    }
  };
  let res = await go(await accessToken());
  if (res.status === 401) {
    const s = await refreshSession();
    res = await go(s.access_token);
    if (res.status === 401) {
      forgetSession();
      throw new SyncError('rejected', 'You were signed out. Please sign in again.', 401);
    }
  }
  return res;
}

export async function signOut() {
  const s = getSession();
  if (s && s.access_token && isConfigured()) {
    try { await authPost('/auth/v1/logout', {}, s.access_token); } catch { /* offline: forget locally anyway */ }
  }
  forgetSession();
}
