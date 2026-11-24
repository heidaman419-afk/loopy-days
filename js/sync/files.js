// Photo bytes <-> Supabase Storage (bucket 'ld-files', private), fetch() only.
//   <user_id>/photos/<photo_id>.jpg  and  <user_id>/photos/<photo_id>_thumb.jpg
// Runs inside a sync, after records are pushed and pulled. Storage problems (bucket
// not set up yet, a thumb the other device hasn't uploaded yet) are quiet and never stop
// the record sync; only "no connection" and "signed out" bubble up.

import * as db from '../db.js';
import { apiFetch, getSession, SyncError } from './auth.js';

const BUCKET = 'ld-files';
const RETRY_MS = 2 * 60 * 1000;          // wait this long before retrying a failed file
const tried = new Map();                  // key -> last failed attempt (this session only)

export const photoPath = (userId, id, thumb = false) => `${userId}/photos/${id}${thumb ? '_thumb' : ''}.jpg`;

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

async function upload(path, blob) {
  const res = await apiFetch(`/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: blob,
  });
  return res.ok;
}

async function download(path) {
  const res = await apiFetch(`/storage/v1/object/authenticated/${BUCKET}/${path}`);
  if (res.ok) return res.blob();
  if (await isMissing(res)) return null;
  throw new SyncError('server', 'Couldn’t fetch a photo just now.', res.status);
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
    console.warn('Loopy Days: photo sync skipped one file', key, e);
    failed(key);
    return false;
  }
}

/**
 * Uploads, deletes and thumbnail downloads. Returns the ids whose local bytes changed
 * (so screens can show new thumbnails).
 */
export async function syncFiles(userId) {
  if (!userId) return [];
  const changed = [];
  const files = await db.getAll('files', { includeDeleted: true });
  const byId = new Map(files.map((f) => [f.id, f]));

  // 1. Upload new photos (full image, then thumbnail).
  for (const f of files) {
    if (f.deleted) continue;
    if (f.blob && !f.uploaded) {
      const p = photoPath(userId, f.id);
      if (await quietly(p, () => upload(p, f.blob))) { f.uploaded = true; f.storage_path = p; await db.putQuiet('files', f); }
    }
    if (f.thumb && !f.thumb_uploaded && f.uploaded) {
      const p = photoPath(userId, f.id, true);
      if (await quietly(p, () => upload(p, f.thumb))) { f.thumb_uploaded = true; await db.putQuiet('files', f); }
    }
  }

  // 2. Remove the online copies of photos deleted here.
  for (const f of files) {
    if (!f.deleted || f.remote_gone) continue;
    if (!f.uploaded && !f.thumb_uploaded) { f.remote_gone = true; await db.putQuiet('files', f); continue; }
    const key = `delete:${f.id}`;
    const ok = await quietly(key, async () =>
      (await remove(photoPath(userId, f.id))) && (await remove(photoPath(userId, f.id, true))));
    if (ok) { f.remote_gone = true; await db.putQuiet('files', f); }
  }

  // 3. Fetch thumbnails for photos that came from another device.
  const photos = await db.getAll('photos', { includeDeleted: true });
  for (const ph of photos) {
    const f = byId.get(ph.id);
    if (ph.deleted) {
      // Deleted on another device: drop our bytes (that device removes the online copy).
      if (f && !f.deleted) {
        Object.assign(f, { blob: null, thumb: null, deleted: true, remote_gone: true, updated_at: new Date().toISOString() });
        await db.putQuiet('files', f);
        changed.push(ph.id);
      }
      continue;
    }
    if (f && (f.thumb || f.blob)) continue;
    const p = photoPath(userId, ph.id, true);
    let blob = null;
    await quietly(p, async () => { blob = await download(p); return !!blob; });
    if (!blob) continue;
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
  return changed;
}

/** Fetch a full-size image when it's first opened, then keep it on this device. */
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
