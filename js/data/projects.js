// Projects. Feature 1 only needs the built-in "Quick counter" project;
// the Projects feature will add real ones through the same functions.

import * as db from '../db.js';

const QUICK_KEY = 'quick_project_id';

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
  const p = await createProject({ name: 'Quick counter', kind: 'quick' });
  await db.setSetting(QUICK_KEY, p.id);
  return p;
}
