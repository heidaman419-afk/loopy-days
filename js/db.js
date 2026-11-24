// Tiny IndexedDB wrapper. No libraries.
//
// Every record carries: id, created_at, updated_at (ISO strings), deleted (boolean)
// and dirty (1 = changed locally and not yet pushed to the server, 0 = in sync).
// The sync module (js/sync/) reads dirtyRecords(store), pushes them, then calls
// markCleanIf(store, [[id, updated_at], ...]). Soft deletes keep the row so the
// deletion can sync too.
//
// After every local write, window gets an 'ld:local-write' event ({ detail: { stores } }).

const DB_NAME = 'loopy-days';

export const STORES = ['projects', 'counters', 'counter_events', 'row_notes', 'sessions', 'settings'];

// Each migration runs once, in order, inside onupgradeneeded.
// To change the schema later, append a function; never edit an old one.
const MIGRATIONS = [
  // v1
  (db) => {
    const make = (name, indexes = []) => {
      const s = db.createObjectStore(name, { keyPath: 'id' });
      s.createIndex('dirty', 'dirty');
      s.createIndex('updated_at', 'updated_at');
      for (const [idx, path] of indexes) s.createIndex(idx, path);
      return s;
    };
    make('projects');
    make('counters', [['project_id', 'project_id']]);
    make('counter_events', [
      ['counter_id', 'counter_id'],
      ['project_at', ['project_id', 'at']],
    ]);
    make('row_notes', [['counter_id', 'counter_id']]);
    make('sessions', [['project_id', 'project_id'], ['started_at', 'started_at']]);
    make('settings', [['key', 'key']]);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, MIGRATIONS.length);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion; v < MIGRATIONS.length; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('Loopy Days: database upgrade is waiting for another tab to close');
  });
  return dbPromise;
}

export const nowISO = () => new Date().toISOString();
export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

/**
 * Fill in the shared fields and mark the record as changed. Mutates and returns rec.
 * updated_at always moves forward (at least 1 ms past the previous value), so two
 * quick changes never share a timestamp and a sync can tell them apart.
 */
export function stamp(rec) {
  let t = Date.now();
  const prev = rec.updated_at ? Date.parse(rec.updated_at) : NaN;
  if (!Number.isNaN(prev) && t <= prev) t = prev + 1;
  const iso = new Date(t).toISOString();
  if (!rec.id) rec.id = newId();
  if (!rec.created_at) rec.created_at = iso;
  rec.updated_at = iso;
  if (typeof rec.deleted !== 'boolean') rec.deleted = !!rec.deleted;
  rec.dirty = 1;
  return rec;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function announce(stores) {
  try { window.dispatchEvent(new CustomEvent('ld:local-write', { detail: { stores } })); } catch { /* no window */ }
}

/** Save one record (stamped). */
export async function put(store, rec) {
  stamp(rec);
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(rec);
  await done(tx);
  announce([store]);
  return rec;
}

/**
 * Save several records in ONE transaction, possibly across stores.
 * entries: [[store, record], ...]. Records are stamped (and cloned by IndexedDB
 * at call time, so later in-memory changes don't leak in).
 */
export async function putMany(entries) {
  if (!entries.length) return;
  for (const [, rec] of entries) stamp(rec);
  const db = await openDB();
  const names = [...new Set(entries.map(([s]) => s))];
  const tx = db.transaction(names, 'readwrite');
  for (const [s, rec] of entries) tx.objectStore(s).put(rec);
  await done(tx);
  announce(names);
}

export async function get(store, id) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(id));
}

/** All records of a store (soft-deleted ones skipped unless asked). */
export async function getAll(store, { includeDeleted = false } = {}) {
  const db = await openDB();
  const rows = await reqP(db.transaction(store).objectStore(store).getAll());
  return includeDeleted ? rows : rows.filter((r) => !r.deleted);
}

/** Records whose index equals value. */
export async function byIndex(store, index, value, { includeDeleted = false } = {}) {
  const db = await openDB();
  const rows = await reqP(db.transaction(store).objectStore(store).index(index).getAll(value));
  return includeDeleted ? rows : rows.filter((r) => !r.deleted);
}

/** Newest-first walk over an index range, stopping after `limit` kept rows. */
export async function latest(store, index, range, limit, keep = (r) => !r.deleted) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(store).objectStore(store).index(index).openCursor(range, 'prev');
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) return resolve(out);
      if (keep(cur.value)) out.push(cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Soft delete: keeps the row with deleted=true so a sync can pass it on. */
export async function remove(store, id) {
  const rec = await get(store, id);
  if (!rec) return;
  rec.deleted = true;
  return put(store, rec);
}
export const markDeleted = remove;

/* ---------- Sync helpers (used by js/sync/) ---------- */

/** Stores that exist in this database (includes stores added by later migrations). */
export async function storeNames() {
  const db = await openDB();
  return [...db.objectStoreNames];
}

export async function dirtyRecords(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index('dirty').getAll(1));
}

/** How many records are waiting to be sent, across all stores. */
export async function countDirty() {
  const db = await openDB();
  const names = [...db.objectStoreNames];
  const tx = db.transaction(names);
  let n = 0;
  for (const s of names) tx.objectStore(s).index('dirty').count(1).onsuccess = (e) => { n += e.target.result; };
  await done(tx);
  return n;
}

/**
 * Mark records as in sync, but only those whose updated_at is still the one we sent.
 * A change made while the push was on its way keeps the record dirty.
 * pairs: [[id, updated_at], ...]
 */
export async function markCleanIf(store, pairs) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const [id, sentAt] of pairs) {
    os.get(id).onsuccess = (e) => {
      const r = e.target.result;
      if (r && r.dirty && r.updated_at === sentAt) { r.dirty = 0; os.put(r); }
    };
  }
  await done(tx);
}

/** Older helper: mark clean unconditionally. */
export async function markClean(store, ids) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const id of ids) {
    os.get(id).onsuccess = (e) => {
      const r = e.target.result;
      if (r) { r.dirty = 0; os.put(r); }
    };
  }
  await done(tx);
}

/**
 * Apply rows that came from the server (one read-compare-write transaction).
 * rows: [{ id, store, data, updated_at, deleted }]
 * A server row wins when there's no local copy, the local copy isn't waiting to be
 * sent, or the server copy is newer. Rows equal to the local copy (our own echo) are
 * skipped. Rows for stores this version doesn't know are skipped.
 * Written records keep the server's timestamps (no re-stamping) and get dirty = 0.
 * Returns { stores: [names that really changed], applied: n }.
 */
export async function applyRemote(rows) {
  const db = await openDB();
  const known = new Set(db.objectStoreNames);
  const usable = rows.filter((r) => known.has(r.store));
  if (!usable.length) return { stores: [], applied: 0 };
  const names = [...new Set(usable.map((r) => r.store))];
  const tx = db.transaction(names, 'readwrite');
  const changed = new Set();
  let applied = 0;
  for (const row of usable) {
    const os = tx.objectStore(row.store);
    os.get(row.id).onsuccess = (e) => {
      const local = e.target.result;
      const serverT = Date.parse(row.updated_at);
      if (local) {
        const localT = Date.parse(local.updated_at);
        if (localT === serverT && !!local.deleted === !!row.deleted) return; // same version
        if (local.dirty && !(serverT > localT)) return;                     // ours is newer, it'll be pushed
      }
      const data = row.data && typeof row.data === 'object' ? row.data : {};
      const rec = { ...data, id: row.id, deleted: !!row.deleted, dirty: 0 };
      rec.updated_at = data.updated_at && Date.parse(data.updated_at) === serverT
        ? data.updated_at : new Date(serverT).toISOString();
      if (!rec.created_at) rec.created_at = rec.updated_at;
      if (row.store === 'settings' && !rec.key && local) rec.key = local.key;
      os.put(rec);
      changed.add(row.store);
      applied++;
    };
  }
  await done(tx);
  return { stores: [...changed], applied };
}

/* ---------- Settings (key/value) ---------- */
// Two devices can each create a row for the same key; after a sync both exist.
// The newest one (tie: larger id) is the one that counts, everywhere.

const newestFirst = (a, b) =>
  (Date.parse(b.updated_at) - Date.parse(a.updated_at)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

async function settingRow(key) {
  const rows = await byIndex('settings', 'key', key, { includeDeleted: true });
  return rows.sort(newestFirst)[0] || null;
}

export async function getSetting(key, fallback = null) {
  const row = await settingRow(key);
  return row && !row.deleted ? row.value : fallback;
}

export async function setSetting(key, value) {
  const rec = (await settingRow(key)) || { id: newId(), key };
  rec.value = value;
  rec.deleted = false;
  return put('settings', rec);
}

/** Ask the browser not to evict our data (best effort). */
export async function askPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch { /* not supported */ }
}
