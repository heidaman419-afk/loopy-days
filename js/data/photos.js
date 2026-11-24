// Project photos.
//  'photos' store (synced like every other store): id, project_id, width, height, mime, taken_at, sort
//  'files'  store (this device only): the same id, with the image bytes:
//     { id, project_id, kind: 'photo', mime, width, height, blob, thumb,
//       uploaded, thumb_uploaded, storage_path, remote_gone, created_at, updated_at, deleted, dirty }
// Photos are shrunk on the device before saving (longest side 1600 px, thumbs 400 px, JPEG 0.8).

import * as db from '../db.js';

const FULL_PX = 1600;
const THUMB_PX = 400;
const QUALITY = 0.8;

/* ---------- shrinking ---------- */

async function decode(file) {
  // createImageBitmap applies the photo's EXIF orientation ('from-image').
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();   // <img> also honours EXIF orientation in current Safari/Chrome
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toJpeg(source, maxSide) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';           // transparent PNGs become white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve({ blob: b, width: w, height: h }) : reject(new Error('Could not shrink the photo'))), 'image/jpeg', QUALITY);
  });
}

export async function shrinkPhoto(file) {
  const src = await decode(file);
  const full = await toJpeg(src, FULL_PX);
  const thumb = await toJpeg(src, THUMB_PX);
  if (src.close) src.close();
  return { full, thumb };
}

/* ---------- saving / listing ---------- */

/** Shrink and save a photo for a project. Shows up at once from the local copy. */
export async function addPhoto(projectId, file) {
  const { full, thumb } = await shrinkPhoto(file);
  const id = db.newId();
  const now = new Date().toISOString();
  await db.putQuiet('files', {
    id, project_id: projectId, kind: 'photo', mime: 'image/jpeg',
    width: full.width, height: full.height, blob: full.blob, thumb: thumb.blob,
    uploaded: false, thumb_uploaded: false, storage_path: null, remote_gone: false,
    created_at: now, updated_at: now, deleted: false, dirty: 1,
  });
  // Metadata last: its 'ld:local-write' wakes the sync, which then uploads the bytes.
  const photo = await db.put('photos', {
    id, project_id: projectId, mime: 'image/jpeg', width: full.width, height: full.height,
    taken_at: now, sort: Date.now(),
  });
  dropUrl(id);
  return photo;
}

export async function listPhotos(projectId) {
  return (await db.byIndex('photos', 'project_id', projectId)).sort((a, b) => a.sort - b.sort);
}

/* ---------- showing ---------- */

const urls = new Map(); // id + kind -> object URL

function dropUrl(id) {
  for (const k of [`${id}:thumb`, `${id}:full`]) {
    if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
  }
}

/** Object URL of a photo's thumbnail from this device, or null if it hasn't arrived yet. */
export async function thumbUrl(id) {
  const k = `${id}:thumb`;
  if (urls.has(k)) return urls.get(k);
  const f = await db.get('files', id);
  const b = f && !f.deleted && (f.thumb || f.blob);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(k, u);
  return u;
}

/** Full-size image: from this device, or fetched once from online storage and kept. */
export async function fullUrl(id) {
  const k = `${id}:full`;
  if (urls.has(k)) return urls.get(k);
  let f = await db.get('files', id);
  if (!(f && f.blob)) {
    const { downloadFull } = await import('../sync/files.js');
    try { await downloadFull(id); } catch { /* offline: fall back to the thumbnail */ }
    f = await db.get('files', id);
  }
  const b = f && !f.deleted && (f.blob || f.thumb);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  if (f.blob) urls.set(k, u);
  return u;
}

/** After the sync brought new bytes, forget cached URLs so screens show them. */
export function refreshUrls(ids) { for (const id of ids) dropUrl(id); }

/* ---------- removing ---------- */

/** Drop the local bytes of a deleted photo; the sync removes the online copy. */
export async function forgetPhotoBytes(id) {
  const f = await db.get('files', id);
  dropUrl(id);
  if (!f) return;
  f.blob = null;
  f.thumb = null;
  f.deleted = true;
  f.updated_at = new Date().toISOString();
  await db.putQuiet('files', f);
}

/** Delete one photo (and stop using it as the cover). */
export async function deletePhoto(photo, project) {
  photo.deleted = true;
  const entries = [['photos', photo]];
  if (project && project.cover_photo_id === photo.id) {
    project.cover_photo_id = null;
    entries.push(['projects', project]);
  }
  await db.putMany(entries);
  await forgetPhotoBytes(photo.id);
}
