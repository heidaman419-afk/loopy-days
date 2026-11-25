// "Start a project" from a pattern: ask the size, make a project linked to the pattern
// (with its main counter), then open the project page.

import * as db from '../db.js';
import { esc } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { openSheet, toast } from '../ui/overlay.js';
import { newProjectRecord } from '../data/projects.js';
import { newCounter } from '../data/counters.js';
import { guideId } from '../data/patterns.js';

/** Ask for one of the pattern's sizes. Resolves to a size id, '' (no sizes) or null (cancelled). */
export function askSize(pattern, { title = 'Pick your size', current = null } = {}) {
  const sizes = pattern.sizes || [];
  if (!sizes.length) return Promise.resolve('');
  return new Promise(async (resolve) => {
    let answer = null;
    const guides = await db.byIndex('guides', 'pattern_id', pattern.id);
    const state = (sid) => {
      const g = guides.find((x) => x.size_id === sid);
      return g ? (g.status === 'ready' ? 'Guide ready' : 'Draft in progress') : '';
    };
    const sheet = openSheet({
      title,
      body: `<p class="settings__p">Which size are you making of ${esc(pattern.name)}?</p>
        <div class="size-list">${sizes.map((s) => `
          <button type="button" class="size-item ${current === s.id ? 'is-on' : ''}" data-size="${s.id}">
            <strong>${esc(s.name)}</strong>${state(s.id) ? `<span>${icons.file}${state(s.id)}</span>` : ''}
            <span class="size-item__dot" aria-hidden="true"></span></button>`).join('')}</div>`,
      onClose: () => resolve(answer),
    });
    sheet.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-size]');
      if (!b) return;
      answer = b.dataset.size;
      sheet.close();
    });
  });
}

export async function startProjectFrom(pattern) {
  const sizeId = await askSize(pattern);
  if (sizeId === null) return;
  const p = newProjectRecord({
    name: pattern.name, craft: pattern.craft || 'knitting', pattern_id: pattern.id, size_id: sizeId || null,
  });
  const guide = await db.get('guides', guideId(pattern.id, sizeId || null));
  const counter = newCounter(p.id, { is_main: true, name: 'Rows', target: guide && !guide.deleted && guide.total_rows ? guide.total_rows : null });
  await db.putMany([['projects', p], ['counters', counter]]);
  toast('Project started');
  location.hash = `#/project/${p.id}`;
}
