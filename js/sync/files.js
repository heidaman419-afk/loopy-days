// File bytes <-> Supabase Storage (bucket 'ld-files', private), fetch() only.
//   photos:  <user_id>/photos/<photo_id>.jpg  and  <user_id>/photos/<photo_id>_thumb.jpg
//   pattern: <user_id>/patterns/<pattern_id>.pdf  and  <user_id>/patterns/<pattern_id>_cover.jpg
// Runs inside a sync, after records are pushed and pulled. Storage problems (bucket
// not set up yet, a file the other device hasn't uploaded yet) are quiet and never stop
// the record sync; only "no connection" and "signed out" bubble up.

import * as db from '../db.js';
import { apiFetch, getSession, SyncError } from './auth.js';

const BUCKET = 'ld-files';
const RETRY_MS = 2 * 60 * 1000;          // wait this long before retrying a failed file
const tried = new Map();                  // key -> last failed attempt (this session only)

export const photoPath = (userId, id, thumb = false) => `${userId}/photos/${id}${thumb ? '_thumb' : ''}.jpg`;
export const patternPath = (userId, patternId, kind) => `${userId}/patterns/${patternId}${kind === 'pdf' ? '.pdf' : '_cover.jpg'}`;

/** Online path(s) of a local file record: [main, thumb|null] */
function pathsOf(userId, f) {
  if (f.kind === 'pdf' || f.kind === 'cover') return [patternPath(userId, f.pattern_id, f.kind), null];
  return [photoPath(userId, f.id), photoPath(userId, f.id, true)];
}
const mimeOf = (f) => f.mime || (f.kind === 'pdf' ? 'application/pdf' : 'image/jpeg');

const coolingDown = (key) => Date.now() - (tried.get(key) || 0) < RETRY_MS;
const failed = (key) => tried.set(key, Date.now());

/** A missing object: Supabase answers 404, or 400 with statusCode "404" / "not_found". */
async function isMissing(res) {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  try {
    const j = await res.clone().json();
    return /404|not.?found/i.test(`${j.statusCode} ${j.error} ${j.message}`);
  } catch { return false; }
}

async function upload(path, blob, mime) {
  const res = await apiFetch(`/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': mime, 'x-upsert': 'true' },
    body: blob,
  });
  return res.ok;
}

async function download(path) {
  const res = await apiFetch(`/storage/v1/object/authenticated/${BUCKET}/${path}`);
  if (res.ok) return res.blob();
  if (await isMissing(res)) return null;
  throw new SyncError('server', 'Couldn’t fetch a file just now.', res.status);
}

async function remove(path) {
  const res = await apiFetch(`/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE' });
  return res.ok || (await isMissing(res));
}

/** Run one file step; network/sign-in problems bubble up, anything else is noted and skipped. */
async function quietly(key, fn) {
  if (coolingDown(key)) return false;
  try {
    const ok = await fn();
    if (!ok) failed(key);
    return ok;
  } catch (e) {
    if (e instanceof SyncError && (e.kind === 'network' || e.kind === 'rejected')) throw e;
    console.warn('Loopy Days: file sync skipped one file', key, e);
    failed(key);
    return false;
  }
}

const keepOffline = () => { try { return new Set(JSON.parse(localStorage.getItem('ld-keep-offline')) || []); } catch { return new Set(); } };

/**
 * Uploads, deletes and downloads. Returns the ids whose local bytes changed
 * (so screens can show new pictures).
 */
export async function syncFiles(userId) {
  if (!userId) return [];
  const changed = [];
  const files = await db.getAll('files', { includeDeleted: true });
  const byId = new Map(files.map((f) => [f.id, f]));

  // 1. Upload new or replaced files (main file, then a photo's thumbnail).
  for (const f of files) {
    if (f.deleted) continue;
    const [main, thumb] = pathsOf(userId, f);
    if (f.blob && !f.uploaded) {
      const v = f.version || 0;
      if (await quietly(`${main}#${v}`, () => upload(main, f.blob, mimeOf(f)))) {
        const cur = await db.get('files', f.id);
        // Only mark it uploaded if it wasn't replaced again while uploading.
        if (cur && (cur.version || 0) === v && !cur.deleted) { cur.uploaded = true; cur.storage_path = main; await db.putQuiet('files', cur); f.uploaded = true; }
      }
    }
    if (thumb && f.thumb && !f.thumb_uploaded && f.uploaded) {
      if (await quietly(thumb, () => upload(thumb, f.thumb, 'image/jpeg'))) { f.thumb_uploaded = true; await db.putQuiet('files', f); }
    }
  }

  // 2. Remove the online copies of things deleted here.
  for (const f of files) {
    if (!f.deleted || f.remote_gone) continue;
    if (!f.uploaded && !f.thumb_uploaded) { f.remote_gone = true; await db.putQuiet('files', f); continue; }
    // A pattern file deleted here may share its path with a newer replacement: keep that one.
    if (f.kind === 'pdf' || f.kind === 'cover') {
      const live = files.find((x) => x !== f && !x.deleted && x.kind === f.kind && x.pattern_id === f.pattern_id);
      if (live) { f.remote_gone = true; await db.putQuiet('files', f); continue; }
    }
    const [main, thumb] = pathsOf(userId, f);
    const ok = await quietly(`delete:${f.id}`, async () => (await remove(main)) && (!thumb || (await remove(thumb))));
    if (ok) { f.remote_gone = true; await db.putQuiet('files', f); }
  }

  // 3. Photos from another device: fetch thumbnails; drop bytes of photos deleted elsewhere.
  const photos = await db.getAll('photos', { includeDeleted: true });
  for (const ph of photos) {
    const f = byId.get(ph.id);
    if (ph.deleted) {
      if (f && !f.deleted) {
        Object.assign(f, { blob: null, thumb: null, deleted: true, remote_gone: true, updated_at: new Date().toISOString() });
        await db.putQuiet('files', f);
        changed.push(ph.id);
      }
      continue;
    }
    const keepFull = keepOffline().has(ph.project_id) && !(f && f.blob);
    if (f && (f.thumb || f.blob) && !keepFull) continue;
    if (!(f && (f.thumb || f.blob))) {
      const p = photoPath(userId, ph.id, true);
      let blob = null;
      await quietly(p, async () => { blob = await download(p); return !!blob; });
      if (blob) {
        const now = new Date().toISOString();
        await db.putQuiet('files', {
          ...(f || {}),
          id: ph.id, project_id: ph.project_id, kind: 'photo', mime: ph.mime || 'image/jpeg',
          width: ph.width, height: ph.height, blob: (f && f.blob) || null, thumb: blob,
          uploaded: true, thumb_uploaded: true, storage_path: photoPath(userId, ph.id), remote_gone: false,
          created_at: (f && f.created_at) || now, updated_at: now, deleted: false, dirty: 0,
        });
        changed.push(ph.id);
      }
    }
    if (keepFull) {
      const p = photoPath(userId, ph.id);
      let ok = false;
      await quietly(p, async () => { ok = await downloadFull(ph.id); return ok; });
      if (ok) changed.push(ph.id);
    }
  }

  // 4. Patterns from another device: covers always (small); PDFs when a project using the
  //    pattern is kept offline on this device. A higher version means it was replaced.
  const patterns = await db.getAll('patterns', { includeDeleted: true });
  const projects = await db.getAll('projects');
  const keep = keepOffline();
  const wantedPdf = new Set(projects.filter((p) => keep.has(p.id) && p.pattern_id).map((p) => p.pattern_id));
  for (const pt of patterns) {
    for (const kind of ['cover', 'pdf']) {
      const id = kind === 'pdf' ? pt.pdf_file_id : pt.cover_file_id;
      if (!id) continue;
      const f = byId.get(id);
      if (pt.deleted) {
        if (f && !f.deleted) { Object.assign(f, { blob: null, deleted: true, remote_gone: true }); await db.putQuiet('files', f); changed.push(id); }
        continue;
      }
      const want = kind === 'cover' || wantedPdf.has(pt.id);
      const version = kind === 'pdf' ? pt.pdf_version || 0 : pt.cover_version || 0;
      const fresh = f && f.blob && (f.version || 0) >= version;
      if (fresh) continue;
      if (f && f.blob && !f.uploaded) continue; // ours, not uploaded yet
      if (f && f.blob && (f.version || 0) < version) {
        // Replaced on another device: drop the old bytes now, fetch the new ones below or on open.
        Object.assign(f, { blob: null, updated_at: new Date().toISOString() });
        await db.putQuiet('files', f);
        changed.push(id);
      }
      if (!want) continue;
      let ok = false;
      await quietly(patternPath(userId, pt.id, kind), async () => { ok = await downloadPatternFile(pt, kind, userId); return ok; });
      if (ok) changed.push(id);
    }
  }
  return changed;
}

/** Fetch a full-size photo when it's first opened, then keep it on this device. */
export async function downloadFull(id) {
  const s = getSession();
  const userId = s && s.user && s.user.id;
  if (!userId) return false;
  const ph = await db.get('photos', id);
  if (!ph || ph.deleted) return false;
  const blob = await download(photoPath(userId, id));
  if (!blob) return false;
  const f = (await db.get('files', id)) || {
    id, project_id: ph.project_id, kind: 'photo', mime: 'image/jpeg', width: ph.width, height: ph.height,
    thumb: null, thumb_uploaded: true, remote_gone: false, created_at: new Date().toISOString(), deleted: false, dirty: 0,
  };
  Object.assign(f, { blob, uploaded: true, storage_path: photoPath(userId, id), updated_at: new Date().toISOString() });
  await db.putQuiet('files', f);
  return true;
}

/** Fetch a pattern's PDF or cover from online storage and keep it on this device. */
export async function downloadPatternFile(pattern, kind, userId) {
  if (!userId) { const s = getSession(); userId = s && s.user && s.user.id; }
  if (!userId || !pattern) return false;
  const id = kind === 'pdf' ? pattern.pdf_file_id : pattern.cover_file_id;
  if (!id) return false;
  const blob = await download(patternPath(userId, pattern.id, kind));
  if (!blob) return false;
  const now = new Date().toISOString();
  const old = await db.get('files', id);
  await db.putQuiet('files', {
    ...(old || {}), id, pattern_id: pattern.id, kind, mime: kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
    blob, thumb: null, size: blob.size, version: kind === 'pdf' ? pattern.pdf_version || 0 : pattern.cover_version || 0,
    uploaded: true, thumb_uploaded: true, storage_path: patternPath(userId, pattern.id, kind), remote_gone: false,
    created_at: (old && old.created_at) || now, updated_at: now, deleted: false, dirty: 0,
  });
  return true;
}

/* ---------- this device's storage (Settings › Offline) ---------- */

export async function localUsage() {
  const files = await db.getAll('files', { includeDeleted: true });
  let bytes = 0; let removable = 0;
  for (const f of files) {
    const b = (f.blob && f.blob.size) || 0;
    const t = (f.thumb && f.thumb.size) || 0;
    bytes += b + t;
    if (f.uploaded && f.blob && f.kind !== 'cover') removable += b;
  }
  return { bytes, removable };
}

/** Drop downloaded full-size files that are safely online (thumbnails and covers stay). */
export async function removeDownloaded() {
  const files = await db.getAll('files', { includeDeleted: true });
  let freed = 0;
  for (const f of files) {
    if (f.uploaded && f.blob && f.kind !== 'cover' && !f.deleted) {
      freed += f.blob.size;
      f.blob = null;
      await db.putQuiet('files', f);
    }
  }
  return freed;
}
