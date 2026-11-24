// Tiny IndexedDB wrapper. No libraries.
//
// Every record carries: id, created_at, updated_at (ISO strings), deleted (boolean)
// and dirty (1 = changed locally and not yet pushed to a server, 0 = in sync).
// A later sync module can read `dirtyRecords(store)`, push them, then call
// `markClean(store, ids)`. Soft deletes keep the row so the deletion can sync too.

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

/** Fill in the shared fields and mark the record as changed. Mutates and returns rec. */
export function stamp(rec) {
  const t = nowISO();
  if (!rec.id) rec.id = newId();
  if (!rec.created_at) rec.created_at = t;
  rec.updated_at = t;
  if (typeof rec.deleted !== 'boolean') rec.deleted = false;
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

/** Save one record (stamped). */
export async function put(store, rec) {
  stamp(rec);
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(rec);
  await done(tx);
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

/* ---------- Sync helpers (used by a future sync module) ---------- */

export async function dirtyRecords(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index('dirty').getAll(1));
}

export async function markClean(store, ids) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const id of ids) {
    const r = await reqP(os.get(id));
    if (r) { r.dirty = 0; os.put(r); }
  }
  await done(tx);
}

/* ---------- Settings (key/value) ---------- */

export async function getSetting(key, fallback = null) {
  const rows = await byIndex('settings', 'key', key);
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(key, value) {
  const rows = await byIndex('settings', 'key', key, { includeDeleted: true });
  const rec = rows[0] || { id: newId(), key };
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
