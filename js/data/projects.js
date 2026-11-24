// Projects. Feature 1 only needs the built-in "Quick counter" project;
// the Projects feature will add real ones through the same functions.

import * as db from '../db.js';
import { byUse } from './counters.js';

export const QUICK_KEY = 'quick_project_id';

export async function getProject(id) {
  const p = await db.get('projects', id);
  return p && !p.deleted ? p : null;
}

export async function createProject(fields) {
  return db.put('projects', {
    name: 'New project',
    kind: 'project',        // 'quick' | 'project'
    status: 'active',       // later: 'active' | 'paused' | 'finished'
    craft: 'knitting',
    notes: '',
    ...fields,
  });
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
