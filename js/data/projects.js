// Projects: the built-in "Quick counter" (kind 'quick', a Home tool) and the
// knitter's own projects (kind 'project', the Projects tab).
//
// Project fields: name, kind, craft, status, start_date / finished_date (local
// 'YYYY-MM-DD' strings), cover_photo_id, pattern_id (feature 6), notes,
// last_worked_at (ISO), sort, draft (true while the new-project form is unfinished).
// The goal ("target rows") lives on the project's main counter: one source of truth.

import * as db from '../db.js';
import { byUse } from './counters.js';

export const QUICK_KEY = 'quick_project_id';

export const STATUSES = [
  ['not_started', 'Not started'],
  ['in_progress', 'In progress'],
  ['on_hold', 'On hold'],
  ['finished', 'Finished'],
  ['frogged', 'Frogged'],
];
export const CRAFTS = [['knitting', 'Knitting'], ['crochet', 'Crochet'], ['other', 'Other']];

const STATUS_KEYS = STATUSES.map(([k]) => k);
/** Unknown or old values (e.g. 'active' from feature 1) read as "not started". */
export const statusOf = (p) => (p && STATUS_KEYS.includes(p.status) ? p.status : 'not_started');
export const statusLabel = (k) => (STATUSES.find(([x]) => x === k) || STATUSES[0])[1];
export const craftOf = (p) => (p && CRAFTS.some(([k]) => k === p.craft) ? p.craft : 'knitting');
export const craftLabel = (k) => (CRAFTS.find(([x]) => x === k) || CRAFTS[0])[1];

/** Today's date on this device as 'YYYY-MM-DD' (never via toISOString, which is UTC). */
export function localDate(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
/** 'YYYY-MM-DD' -> "14 Nov 2026" (read as a local date, never shifted). */
export function niceDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function getProject(id) {
  const p = await db.get('projects', id);
  return p && !p.deleted ? p : null;
}

export function newProjectRecord(fields = {}) {
  return {
    id: db.newId(),
    name: '',
    kind: 'project',
    craft: 'knitting',
    status: 'not_started',
    start_date: null,
    finished_date: null,
    cover_photo_id: null,
    pattern_id: null,
    notes: '',
    last_worked_at: null,
    sort: Date.now(),
    draft: false,
    ...fields,
  };
}

export async function createProject(fields) {
  return db.put('projects', newProjectRecord(fields));
}

/** The knitter's own projects (no Quick counter; drafts only when asked). */
export async function listProjects({ drafts = false } = {}) {
  return (await db.getAll('projects')).filter((p) => p.kind !== 'quick' && (drafts ? !!p.draft : !p.draft));
}

/** The project's main counter (the one actually used, if two devices each made one). */
export async function mainCounterOf(projectId) {
  return (await db.byIndex('counters', 'project_id', projectId)).filter((c) => c.is_main).sort(byUse)[0] || null;
}

/** 0-100. Finished = 100; with a goal = count / goal; otherwise 0. */
export function progressOf(project, main) {
  if (statusOf(project) === 'finished') return 100;
  if (main && main.target > 0) return Math.max(0, Math.min(100, Math.round((main.value / main.target) * 100)));
  return 0;
}

/** Latest of project.last_worked_at and the main counter's last tap (ISO or null). */
export function lastWorked(project, main) {
  const a = project && project.last_worked_at;
  const b = main && main.last_tapped_at;
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Knitting started or went on: switch "Not started" to "In progress", set the start
 * date if empty, and note when it was last worked. Writes are kept rare (status
 * change or a minute passed). Mutates the project; returns true if it must be saved.
 */
export function markWorked(project, now = new Date()) {
  if (!project || project.kind === 'quick') return false;
  let changed = false;
  if (statusOf(project) === 'not_started') { project.status = 'in_progress'; changed = true; }
  if (!project.start_date) { project.start_date = localDate(now); changed = true; }
  const last = project.last_worked_at ? Date.parse(project.last_worked_at) : 0;
  if (changed || now.getTime() - last > 60000) { project.last_worked_at = now.toISOString(); changed = true; }
  return changed;
}

/**
 * Soft delete a project and what belongs to it: counters, row notes, counter events,
 * photos (their bytes are removed online by the sync). Sessions stay for stats.
 */
export async function deleteProject(id) {
  const p = await db.get('projects', id);
  if (!p) return;
  const entries = [['projects', Object.assign(p, { deleted: true })]];
  for (const c of await db.byIndex('counters', 'project_id', id)) {
    entries.push(['counters', Object.assign(c, { deleted: true })]);
    for (const n of await db.byIndex('row_notes', 'counter_id', c.id)) entries.push(['row_notes', Object.assign(n, { deleted: true })]);
  }
  const range = IDBKeyRange.bound([id, ''], [id, '￿']);
  for (const e of await db.latest('counter_events', 'project_at', range, Infinity)) {
    entries.push(['counter_events', Object.assign(e, { deleted: true })]);
  }
  for (const gp of await db.byIndex('guide_progress', 'project_id', id)) entries.push(['guide_progress', Object.assign(gp, { deleted: true })]);
  const photos = await db.byIndex('photos', 'project_id', id);
  for (const ph of photos) entries.push(['photos', Object.assign(ph, { deleted: true })]);
  await db.putMany(entries);
  const { forgetPhotoBytes } = await import('./photos.js');
  for (const ph of photos) await forgetPhotoBytes(ph.id);
}

/** The default project behind the home screen's "Row counter" tile. */
export async function ensureQuickProject() {
  const id = await db.getSetting(QUICK_KEY);
  if (id) {
    const p = await getProject(id);
    if (p) return p;
  }
  // The setting may point at nothing (e.g. deleted elsewhere): reuse an existing quick project first.
  const best = await bestQuickProject();
  if (best) { await db.setSetting(QUICK_KEY, best.id); return best; }
  const p = await createProject({ name: 'Quick counter', kind: 'quick' });
  await db.setSetting(QUICK_KEY, p.id);
  return p;
}

/**
 * Among all quick projects, the one whose main counter was used most recently
 * (an untouched one, like the empty project a new device makes, always loses).
 * Every device picks the same one from the same data.
 */
async function bestQuickProject() {
  const quick = (await db.getAll('projects')).filter((p) => p.kind === 'quick');
  if (!quick.length) return null;
  const scored = [];
  for (const p of quick) {
    const mains = (await db.byIndex('counters', 'project_id', p.id)).filter((c) => c.is_main).sort(byUse);
    scored.push({ p, c: mains[0] || { id: p.id, last_tapped_at: null, updated_at: p.updated_at } });
  }
  scored.sort((a, b) => byUse(a.c, b.c));
  return scored[0].p;
}

/**
 * After a sync: if two devices each made their own Quick counter, keep both but point
 * quick_project_id at the one that was really used. Returns true if it changed.
 */
export async function reconcileQuickProject() {
  const quick = (await db.getAll('projects')).filter((p) => p.kind === 'quick');
  const current = await db.getSetting(QUICK_KEY);
  if (quick.length < 2 && quick.some((p) => p.id === current)) return false;
  const best = await bestQuickProject();
  if (!best || best.id === current) return false;
  await db.setSetting(QUICK_KEY, best.id);
  return true;
}
