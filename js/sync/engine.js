// Offline-first sync with the Supabase table public.ld_records, using fetch() only.
//
// Runs only when config.js is filled in AND someone is signed in. Every store in the
// local database takes part automatically. All work is async and never touches the
// tap path: counting writes to IndexedDB first; this module catches up afterwards.
//
//  push: dirty records -> POST /rest/v1/ld_records?on_conflict=id (batches of 200)
//  pull: GET rows with server_seq > last_seq (pages of 1000), apply last-change-wins
//
// Device-only state (last_seq, last success) lives in localStorage, never in synced stores.

import * as db from '../db.js';
import { isConfigured, getSession, apiFetch, onAuthChange, SyncError } from './auth.js';
import { reconcileQuickProject } from '../data/projects.js';
import { syncFiles } from './files.js';
import { refreshUrls } from '../data/photos.js';
import { refreshPatternUrls } from '../data/patterns.js';

const PUSH_BATCH = 200;
const PULL_PAGE = 1000;
const WRITE_DEBOUNCE_MS = 3000;
const INTERVAL_MS = 60000;
const BACKOFF_MS = [5000, 15000, 30000, 60000, 120000, 300000];
const LOCAL_KEY = 'ld-sync';

/* ---------- device-only sync memory ---------- */

function local() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; }
}
function saveLocal(patch) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...local(), ...patch }));
}
/** last_seq belongs to one user and one schema version; anything else starts from 0. */
function lastSeq(userId) {
  const l = local();
  return l.user_id === userId && l.schema === db.SCHEMA_VERSION ? (l.last_seq || 0) : 0;
}

/* ---------- status ---------- */

// state: 'off' (not set up) | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error'
const status = { state: 'off', pending: 0, lastOk: null, error: '', retryAt: 0 };
const statusListeners = new Set();

export const getStatus = () => ({ ...status, lastOk: status.lastOk || local().last_ok || null });
export function onStatus(fn) {
  statusListeners.add(fn);
  fn(getStatus());
  return () => statusListeners.delete(fn);
}
function setStatus(patch) {
  Object.assign(status, patch);
  const s = getStatus();
  for (const fn of statusListeners) try { fn(s); } catch (e) { console.error(e); }
}

/** Plain-words description used by Settings and the Home indicator. */
export function describe(s = getStatus(), now = Date.now()) {
  const n = s.pending;
  const changes = `${n} ${n === 1 ? 'change' : 'changes'}`;
  switch (s.state) {
    case 'off': return { tone: 'off', text: 'Sync isn’t set up yet' };
    case 'signed-out': return { tone: 'off', text: 'Not signed in · everything stays on this device' };
    case 'syncing': return { tone: 'busy', text: 'Syncing…' };
    case 'offline': return {
      tone: 'wait',
      text: n ? `Offline · ${changes} will sync when you’re back online` : 'Offline · everything is saved on this device',
    };
    case 'error': return { tone: 'error', text: s.error || 'Couldn’t sync just now', retry: true };
    default: {
      if (n) return { tone: 'wait', text: `${changes} waiting to sync` };
      return { tone: 'ok', text: s.lastOk ? `All changes saved online · ${ago(s.lastOk, now)}` : 'All changes saved online' };
    }
  }
}

function ago(iso, now) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const active = () => isConfigured() && !!getSession();

/* ---------- push ---------- */

async function push() {
  let sent = 0;
  for (const store of await db.storeNames()) {
    const dirty = await db.dirtyRecords(store);
    for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
      const batch = dirty.slice(i, i + PUSH_BATCH);
      const body = batch.map((r) => {
        const { dirty: _local, ...data } = r;
        return { id: r.id, store, data, updated_at: r.updated_at, deleted: !!r.deleted };
      });
      const res = await apiFetch('/rest/v1/ld_records?on_conflict=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await restError(res);
      await db.markCleanIf(store, batch.map((r) => [r.id, r.updated_at]));
      sent += batch.length;
    }
  }
  return sent;
}

/* ---------- pull ---------- */

async function pull(userId) {
  let seq = lastSeq(userId);
  const changed = new Set();
  for (;;) {
    const q = `/rest/v1/ld_records?select=id,store,data,updated_at,deleted,server_seq`
      + `&server_seq=gt.${seq}&order=server_seq.asc&limit=${PULL_PAGE}`;
    const res = await apiFetch(q, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw await restError(res);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new SyncError('server', 'The server sent something unexpected.');
    if (rows.length) {
      const r = await db.applyRemote(rows);
      r.stores.forEach((s) => changed.add(s));
      seq = Math.max(seq, ...rows.map((x) => Number(x.server_seq) || 0));
      saveLocal({ user_id: userId, schema: db.SCHEMA_VERSION, last_seq: seq });
    }
    if (rows.length < PULL_PAGE) break;
  }
  return [...changed];
}

async function restError(res) {
  let j = {};
  try { j = await res.json(); } catch { /* empty */ }
  const code = String(j.code || '');
  if (res.status === 404 || code === '42P01' || code === 'PGRST205') {
    return new SyncError('server', 'The online table isn’t set up yet.', res.status);
  }
  if (res.status === 401 || res.status === 403 || code === '42501') {
    return new SyncError('rejected', 'The server didn’t accept this sign-in. Please sign in again.', res.status);
  }
  return new SyncError('server', 'The server couldn’t save just now.', res.status);
}

/* ---------- running a sync ---------- */

let running = null;
let again = false;
let failures = 0;
let retryTimer = null;
let writeTimer = null;
let intervalTimer = null;
let pendingTimer = null;
let started = false;

async function refreshPending() {
  try { setStatus({ pending: await db.countDirty() }); } catch { /* db closed */ }
}

/** Run one sync now (or once more after the current one). Resolves when done. */
export function syncNow() {
  if (!active()) { refreshBaseState(); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  running = (async () => {
    let ok = false;
    do {
      again = false;
      ok = await runOnce();
    } while (again && ok);
    return ok;
  })().finally(() => { running = null; });
  return running;
}

async function runOnce() {
  clearTimeout(retryTimer); retryTimer = null;
  const session = getSession();
  if (!session) { refreshBaseState(); return false; }
  setStatus({ state: 'syncing', error: '' });
  try {
    const userId = session.user && session.user.id;
    // Push first, so a device that was used offline (or before signing in) gets its data up.
    await push();
    const changed = await pull(userId);
    if (changed.length) {
      const extra = await reconcileQuickProject();
      if (extra) changed.push('settings');
      window.dispatchEvent(new CustomEvent('ld:data-changed', { detail: { stores: [...new Set(changed)] } }));
    }
    // A quick project switch writes a setting: send it straight away.
    if ((await db.countDirty()) > 0 && !again) await push();
    // Photo bytes after the records (quiet: storage hiccups never fail the sync).
    const files = await syncFiles(userId);
    if (files.length) {
      refreshUrls(files);
      refreshPatternUrls(files);
      window.dispatchEvent(new CustomEvent('ld:files-changed', { detail: { ids: files } }));
    }
    failures = 0;
    const now = new Date().toISOString();
    saveLocal({ last_ok: now });
    setStatus({ state: 'idle', lastOk: now, error: '', retryAt: 0 });
    await refreshPending();
    return true;
  } catch (e) {
    await refreshPending();
    if (!(e instanceof SyncError)) console.error(e);
    if (e.kind === 'rejected') { setStatus({ state: getSession() ? 'error' : 'signed-out', error: e.message }); return false; }
    const offline = e.kind === 'network' || navigator.onLine === false;
    const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
    failures++;
    setStatus({
      state: offline ? 'offline' : 'error',
      error: offline ? '' : (e.message || 'Couldn’t sync just now'),
      retryAt: Date.now() + wait,
    });
    retryTimer = setTimeout(() => syncNow(), wait);
    return false;
  }
}

function refreshBaseState() {
  if (!isConfigured()) setStatus({ state: 'off', error: '' });
  else if (!getSession()) setStatus({ state: 'signed-out', error: '' });
  else if (status.state === 'off' || status.state === 'signed-out') setStatus({ state: 'idle' });
}

/** Called once at app start. Safe to call when sync isn't set up: it just reports 'off'. */
export function startSync() {
  if (started) return;
  started = true;
  refreshBaseState();
  refreshPending();
  if (!isConfigured()) return;

  window.addEventListener('ld:local-write', () => {
    if (!active()) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { refreshPending(); syncNow(); }, WRITE_DEBOUNCE_MS);
    // keep the "waiting to sync" count roughly current without touching the tap path
    if (!pendingTimer) pendingTimer = setTimeout(() => { pendingTimer = null; refreshPending(); }, 400);
  });
  window.addEventListener('online', () => { failures = 0; syncNow(); });
  window.addEventListener('offline', () => { if (active()) setStatus({ state: 'offline' }); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  intervalTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, INTERVAL_MS);
  onAuthChange((s) => {
    refreshBaseState();
    if (s) { failures = 0; syncNow(); } else { clearTimeout(retryTimer); }
  });
  syncNow();
}

/** Forget this device's sync position (after signing out). Local data is kept. */
export function resetSyncMemory() {
  localStorage.removeItem(LOCAL_KEY);
  setStatus({ lastOk: null });
}
