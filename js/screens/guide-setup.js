// #/guide-size/<patternId>[/<sizeId>[/<projectId>]]
// "Pick your size" (when no size is given), then "Make a guide": read it from the PDF,
// copy another size's guide, or start fresh. Then opens the guide editor.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/overlay.js';
import { getPattern, guidesOf, guideId, guideFromPdf, saveGuide } from '../data/patterns.js';
import { totalRows } from '../patterns/guide-math.js';

export const fullscreen = true;

export async function mount(root, params) {
  const pattern = await getPattern(params[0]);
  if (!pattern) { location.hash = '#/patterns'; return; }
  const projectId = params[2] || null;
  const back = projectId ? `#/project/${projectId}` : `#/pattern/${pattern.id}`;
  const guides = (await guidesOf(pattern.id)).filter((g) => !g.deleted);
  const sizes = pattern.sizes || [];
  const sizeName = (id) => (sizes.find((s) => s.id === id) || { name: 'One size' }).name;
  let picked = params[1] && params[1] !== 'one' ? params[1] : (params[1] === 'one' ? 'one' : null);

  function pickScreen() {
    root.innerHTML = `
      <header class="soft-head"><a class="icon-btn icon-btn--round" href="${back}" aria-label="Back">${icons.back}</a></header>
      <main class="setup">
        <div class="setup__art">${icons.ruler}</div>
        <h1 class="setup__title">Pick your size</h1>
        <p class="settings__p">Which size are you making of ${esc(pattern.name)}?</p>
        <div class="size-list">${sizes.map((s) => {
          const g = guides.find((x) => x.size_id === s.id);
          return `<button type="button" class="size-item" data-size="${s.id}"><strong>${esc(s.name)}</strong>
            ${g ? `<span>${icons.file}${g.status === 'ready' ? 'Guide ready' : 'Draft in progress'}</span>` : ''}<span class="size-item__dot"></span></button>`;
        }).join('')}</div>
      </main>
      <footer class="knit-bar"><button type="button" class="knit-bar__go" data-go disabled><span class="knit-bar__label">Select a size</span></button></footer>`;
    root.addEventListener('click', onPick);
  }
  async function onPick(e) {
    const s = e.target.closest('[data-size]');
    if (s) {
      picked = s.dataset.size;
      root.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('is-on', b === s));
      const go = root.querySelector('[data-go]');
      go.disabled = false;
      go.querySelector('.knit-bar__label').textContent = `Continue with ${sizeName(picked)}`;
    }
    if (e.target.closest('[data-go]') && picked) {
      root.removeEventListener('click', onPick);
      await afterPick();
    }
  }

  async function afterPick() {
    const sizeId = picked === 'one' ? null : picked;
    if (projectId) {
      const pr = await db.get('projects', projectId);
      if (pr && pr.size_id !== sizeId) { pr.size_id = sizeId; await db.put('projects', pr); }
    }
    const existing = guides.find((g) => (g.size_id || null) === sizeId);
    if (existing && projectId) { location.hash = back; return; }
    if (existing) { location.hash = `#/guide-edit/${existing.id}${projectId ? `/${projectId}` : ''}`; return; }
    makeScreen(sizeId);
  }

  function makeScreen(sizeId) {
    const copies = guides.filter((g) => (g.size_id || null) !== sizeId);
    const canRead = (pattern.source_groups || []).length > 0;
    root.innerHTML = `
      <header class="soft-head"><a class="icon-btn icon-btn--round" href="${back}" aria-label="Back">${icons.back}</a></header>
      <main class="setup">
        <div class="setup__art">${icons.patterns}</div>
        <h1 class="setup__title">Make a guide for ${esc(sizeName(sizeId))}</h1>
        <p class="settings__p">A guide breaks the pattern into steps, so you always know which row you’re on.</p>
        <div class="why">
          <div class="why__item">${icons.list}<span><strong>Pieces and steps</strong>Body, sleeves, edging: each part in clear steps.</span></div>
          <div class="why__item">${icons.counter}<span><strong>Always know your row</strong>The row you’re on, with its full instruction, big and clear.</span></div>
          <div class="why__item">${icons.stats}<span><strong>See it grow</strong>Progress fills up as you work through each part.</span></div>
        </div>
      </main>
      <footer class="setup-actions">
        ${canRead ? `<button type="button" class="btn btn--butter btn--block" data-read>${icons.file}<span>Read it from the PDF</span></button>` : ''}
        ${copies.map((g) => `<button type="button" class="btn btn--secondary btn--block" data-copy="${g.id}">${icons.copy}<span>Copy from “${esc(sizeName(g.size_id))}”</span></button>`).join('')}
        <button type="button" class="btn ${canRead ? 'btn--secondary' : 'btn--butter'} btn--block" data-fresh>${icons.pencil}<span>Start fresh</span></button>
        <a class="btn btn--text btn--block" href="${back}">Not now</a>
      </footer>`;
    root.querySelector('.setup-actions').addEventListener('click', async (e) => {
      let tree = null;
      if (e.target.closest('[data-read]')) {
        tree = guideFromPdf(pattern, sizeId);
        if (!totalRows(tree) && !(tree.pieces || []).length) { toast('No steps could be read from this PDF. Start fresh instead.'); return; }
      } else if (e.target.closest('[data-copy]')) {
        const src = guides.find((g) => g.id === e.target.closest('[data-copy]').dataset.copy);
        tree = JSON.parse(JSON.stringify(src.tree));
      } else if (e.target.closest('[data-fresh]')) {
        tree = { pieces: [{ id: `p${Date.now().toString(36)}`, name: pattern.name || 'Piece', sections: [{ id: `s${Date.now().toString(36)}`, name: 'Section 1', blocks: [] }] }] };
      } else return;
      const g = await saveGuide(pattern, sizeId, tree, 'draft');
      location.hash = `#/guide-edit/${g.id}${projectId ? `/${projectId}` : ''}`;
    });
  }

  if (picked) { await afterPick(); return; }
  if (!sizes.length) { picked = 'one'; await afterPick(); return; }
  pickScreen();
  void guideId;
}
