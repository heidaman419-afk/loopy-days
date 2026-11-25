// Patterns, their guides and each project's place in a guide.
//
// patterns (synced): name, designer, craft, category, difficulty, description, sizes
//   [{ id, name, pos }] (pos = order in the PDF, used to pick numbers from "a (b) c"),
//   measurements, gauge, needles, yarns [...], tools [...], glossary [{ abbr, meaning }],
//   notes [{ title, text }] (read first), source_groups (instruction lines from the PDF),
//   pdf_file_id, pdf_name, pdf_size, pdf_pages, pdf_version, cover_file_id, cover_version, from_pdf {field: true}
// guides (synced, one per pattern + size, id derived from both): pattern_id, size_id, status
//   'draft' | 'ready', tree { pieces: [...] }, total_rows
// guide_progress (synced, one per project, id derived from the project): project_id, guide_id,
//   cursor { block_id, rep, row, cast, done }, block_ms { blockId: ms }, completed_at
// files (this device only): kind 'pdf' | 'cover' with pattern_id, plus the bytes.

import * as db from '../db.js';
import { buildGuide } from '../patterns/parse-guide.js';
import { totalRows, clamp } from '../patterns/guide-math.js';

export const CATEGORIES = [
  // [key, label, group]
  ['sweater', 'Sweater', 'tops'], ['cardigan', 'Cardigan', 'tops'], ['top', 'Top / tee', 'tops'], ['vest', 'Vest / slipover', 'tops'],
  ['shawl', 'Shawl / wrap', 'shawls'], ['scarf', 'Scarf / cowl', 'shawls'],
  ['hat', 'Hat', 'hats'], ['headband', 'Headband', 'hats'],
  ['socks', 'Socks', 'socks'], ['slippers', 'Slippers', 'socks'],
  ['mittens', 'Mittens / gloves', 'other'],
  ['blanket', 'Blanket', 'blankets'], ['baby', 'Baby things', 'other'],
  ['toy', 'Toy', 'toys'], ['bag', 'Bag', 'other'], ['home', 'Home', 'other'],
  ['dishcloth', 'Dishcloth', 'other'], ['other', 'Something else', 'other'],
];
export const CATEGORY_GROUPS = [
  ['all', 'All'], ['tops', 'Sweaters & tops'], ['shawls', 'Shawls & scarves'], ['hats', 'Hats'],
  ['socks', 'Socks'], ['blankets', 'Blankets'], ['toys', 'Toys'], ['other', 'Other'],
];
export const DIFFICULTIES = [['', 'Not set'], ['beginner', 'Beginner'], ['easy', 'Easy'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced'], ['expert', 'Expert']];
export const WEIGHTS = [['lace', 'Lace'], ['fingering', 'Fingering'], ['sport', 'Sport'], ['dk', 'DK'], ['worsted', 'Worsted'], ['aran', 'Aran'], ['bulky', 'Bulky'], ['super_bulky', 'Super bulky']];

export const categoryLabel = (k) => (CATEGORIES.find(([x]) => x === k) || [null, ''])[1];
export const categoryGroup = (k) => (CATEGORIES.find(([x]) => x === k) || [null, null, 'other'])[2];
export const difficultyLabel = (k) => (DIFFICULTIES.find(([x]) => x === k) || DIFFICULTIES[0])[1];
export const weightLabel = (k) => (WEIGHTS.find(([x]) => x === k) || [null, ''])[1];

/** Guess a category from the pattern's name and text. */
export function guessCategory(text) {
  const t = String(text || '').toLowerCase();
  const rules = [['shawl', /shawl|wrap\b|stole/], ['scarf', /scarf|cowl|snood/], ['cardigan', /cardigan/], ['sweater', /sweater|jumper|pullover/],
    ['vest', /vest|slipover/], ['top', /\btop\b|\btee\b|t-shirt/], ['hat', /\bhat\b|beanie|bonnet|balaclava/], ['socks', /sock/],
    ['mittens', /mitten|glove/], ['blanket', /blanket|throw/], ['toy', /toy|amigurumi|teddy/], ['dishcloth', /dishcloth|washcloth/]];
  for (const [k, re] of rules) if (re.test(t)) return k;
  return '';
}

export function newPatternRecord(fields = {}) {
  return {
    id: db.newId(), name: '', designer: '', craft: 'knitting', category: '', difficulty: '', description: '',
    sizes: [], measurements: [], gauge: '', needles: '', yarns: [], tools: [], glossary: [], notes: [],
    source_groups: [], pdf_file_id: null, pdf_name: '', pdf_size: 0, pdf_pages: 0, pdf_version: 0,
    cover_file_id: null, cover_version: 0, from_pdf: {}, ...fields,
  };
}

export async function getPattern(id) {
  const p = id ? await db.get('patterns', id) : null;
  return p && !p.deleted ? p : null;
}
export async function listPatterns() {
  return (await db.getAll('patterns')).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
export const savePattern = (p) => db.put('patterns', p);

/* ---------- files: PDF + cover ---------- */

async function putFile(pattern, kind, blob, mime) {
  const idKey = kind === 'pdf' ? 'pdf_file_id' : 'cover_file_id';
  const verKey = kind === 'pdf' ? 'pdf_version' : 'cover_version';
  pattern[idKey] = pattern[idKey] || db.newId();
  pattern[verKey] = (pattern[verKey] || 0) + 1;
  const now = new Date().toISOString();
  const old = await db.get('files', pattern[idKey]);
  // Replacing updates the same record in place: same online path, new version, upload again.
  await db.putQuiet('files', {
    ...(old || {}), id: pattern[idKey], pattern_id: pattern.id, kind, mime, blob, thumb: null,
    size: blob.size, version: pattern[verKey], uploaded: false, thumb_uploaded: true, remote_gone: false,
    storage_path: null, created_at: (old && old.created_at) || now, updated_at: now, deleted: false, dirty: 1,
  });
  dropUrl(pattern[idKey]);
}
export const setPatternPdf = (pattern, file) => putFile(pattern, 'pdf', file, 'application/pdf');
export const setPatternCover = (pattern, blob) => putFile(pattern, 'cover', blob, 'image/jpeg');

export async function removePatternCover(pattern) {
  if (!pattern.cover_file_id) return;
  await forgetFile(pattern.cover_file_id);
  pattern.cover_file_id = null;
}
export async function removePatternPdf(pattern) {
  if (!pattern.pdf_file_id) return;
  await forgetFile(pattern.pdf_file_id);
  Object.assign(pattern, { pdf_file_id: null, pdf_name: '', pdf_size: 0, pdf_pages: 0 });
}

async function forgetFile(id) {
  const f = await db.get('files', id);
  dropUrl(id);
  if (!f) return;
  Object.assign(f, { blob: null, thumb: null, deleted: true, updated_at: new Date().toISOString() });
  await db.putQuiet('files', f);
}

const urls = new Map();
function dropUrl(id) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } }
export function refreshPatternUrls(ids) { for (const id of ids) dropUrl(id); }

/** Object URL of the pattern's cover, from this device (null until it has arrived). */
export async function coverUrl(pattern) {
  if (!pattern || !pattern.cover_file_id) return null;
  if (urls.has(pattern.cover_file_id)) return urls.get(pattern.cover_file_id);
  const f = await db.get('files', pattern.cover_file_id);
  if (!f || f.deleted || !f.blob) return null;
  const u = URL.createObjectURL(f.blob);
  urls.set(pattern.cover_file_id, u);
  return u;
}

/** The PDF bytes: from this device, or fetched once from online storage and kept. */
export async function pdfBlob(pattern) {
  if (!pattern || !pattern.pdf_file_id) return null;
  let f = await db.get('files', pattern.pdf_file_id);
  if (!(f && f.blob && (f.version || 0) >= (pattern.pdf_version || 0))) {
    const { downloadPatternFile } = await import('../sync/files.js');
    try { await downloadPatternFile(pattern, 'pdf'); } catch (e) { console.warn('pdf download', e); }
    f = await db.get('files', pattern.pdf_file_id);
  }
  return f && !f.deleted && f.blob ? f.blob : null;
}
export async function hasLocalPdf(pattern) {
  if (!pattern || !pattern.pdf_file_id) return false;
  const f = await db.get('files', pattern.pdf_file_id);
  return !!(f && f.blob && !f.deleted);
}

/* ---------- guides ---------- */

export const guideId = (patternId, sizeId) => db.uuidFrom(`guide:${patternId}:${sizeId || 'one'}`);

export async function guidesOf(patternId) {
  return db.byIndex('guides', 'pattern_id', patternId);
}
export async function getGuide(id) {
  const g = id ? await db.get('guides', id) : null;
  return g && !g.deleted ? g : null;
}

/** Build a guide for one size from the PDF text kept with the pattern. */
export function guideFromPdf(pattern, sizeId) {
  const sizes = pattern.sizes || [];
  const size = sizes.find((s) => s.id === sizeId);
  const count = sizes.filter((s) => s.pos != null).length;
  return buildGuide(pattern.source_groups || [], {
    name: pattern.name, sizeIndex: size && size.pos != null ? size.pos : 0, sizeCount: count || 1,
  });
}

export async function saveGuide(pattern, sizeId, tree, status = 'draft') {
  const id = guideId(pattern.id, sizeId);
  const old = await db.get('guides', id);
  const g = { ...(old || {}), id, pattern_id: pattern.id, size_id: sizeId || null, status, tree, total_rows: totalRows(tree), deleted: false };
  return db.put('guides', g);
}

/* ---------- progress ---------- */

export const progressId = (projectId) => db.uuidFrom(`progress:${projectId}`);

export async function getProgress(projectId) {
  const p = await db.get('guide_progress', progressId(projectId));
  return p && !p.deleted ? p : null;
}

/** Progress for a project on a guide (made on first use; the cursor is kept valid). */
export async function progressFor(project, guide) {
  let p = await getProgress(project.id);
  if (!p || p.guide_id !== guide.id) {
    p = { id: progressId(project.id), project_id: project.id, guide_id: guide.id, cursor: null, block_ms: {}, completed_at: null, deleted: false };
  }
  p.cursor = clamp(guide.tree, p.cursor);
  return p;
}

/* ---------- delete / duplicate ---------- */

/** Soft delete a pattern, its guides and files. Projects using it are kept, just unlinked. */
export async function deletePattern(id) {
  const p = await db.get('patterns', id);
  if (!p) return;
  const entries = [['patterns', Object.assign(p, { deleted: true })]];
  for (const g of await guidesOf(id)) entries.push(['guides', Object.assign(g, { deleted: true })]);
  for (const pr of (await db.getAll('projects')).filter((x) => x.pattern_id === id)) {
    entries.push(['projects', Object.assign(pr, { pattern_id: null, size_id: null })]);
  }
  await db.putMany(entries);
  if (p.pdf_file_id) await forgetFile(p.pdf_file_id);
  if (p.cover_file_id) await forgetFile(p.cover_file_id);
}

export async function duplicatePattern(id) {
  const p = await getPattern(id);
  if (!p) return null;
  const copy = newPatternRecord({ ...JSON.parse(JSON.stringify(p)), id: db.newId(), name: `${p.name} (copy)`, pdf_file_id: null, cover_file_id: null, pdf_version: 0, cover_version: 0 });
  delete copy.created_at; delete copy.updated_at; delete copy.dirty;
  const pdf = p.pdf_file_id ? await db.get('files', p.pdf_file_id) : null;
  if (pdf && pdf.blob) await setPatternPdf(copy, pdf.blob);
  const cov = p.cover_file_id ? await db.get('files', p.cover_file_id) : null;
  if (cov && cov.blob) await setPatternCover(copy, cov.blob);
  await savePattern(copy);
  for (const g of await guidesOf(id)) if (!g.deleted) await saveGuide(copy, g.size_id, g.tree, g.status);
  return copy;
}

/* ---------- this device: keep files offline ---------- */

const KEEP = 'ld-keep-offline';
export const keptOffline = () => { try { return new Set(JSON.parse(localStorage.getItem(KEEP)) || []); } catch { return new Set(); } };
export function setKeepOffline(projectId, on) {
  const s = keptOffline();
  if (on) s.add(projectId); else s.delete(projectId);
  localStorage.setItem(KEEP, JSON.stringify([...s]));
}
