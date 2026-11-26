// Guide editor (#/guide-edit/<guideId>[/<projectId>]): pieces > sections > blocks.
// Tap a block to edit it; add, move up/down, delete; undo/redo; review and save.
// Block ids stay the same when editing, so a project's place in the guide is kept.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc, el } from '../ui/dom.js';
import { openSheet, confirmDialog, promptDialog, toast } from '../ui/overlay.js';
import { getGuide, getPattern, saveGuide, rebuildGuide, planRebuild } from '../data/patterns.js';
import { counts, totalRows, flatten } from '../patterns/guide-math.js';
import { KIND_LABEL, blockSummary, pieceLabel } from '../patterns/ui.js';

export const fullscreen = true;
const nid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function mount(root, params) {
  const guide = await getGuide(params[0]);
  if (!guide) { location.hash = '#/patterns'; return; }
  const pattern = await getPattern(guide.pattern_id);
  if (!pattern) { location.hash = '#/patterns'; return; }
  const projectId = params[1] || null;
  const back = projectId ? `#/project/${projectId}` : `#/pattern/${pattern.id}`;
  const sizeName = ((pattern.sizes || []).find((s) => s.id === guide.size_id) || { name: 'One size' }).name;
  let tree = JSON.parse(JSON.stringify(guide.tree || { pieces: [] }));
  const undo = []; const redo = [];
  let lastLabel = '';
  let saveTimer = null;

  const snapshot = (label) => { undo.push({ tree: JSON.stringify(tree), label }); if (undo.length > 40) undo.shift(); redo.length = 0; lastLabel = label; };
  const commit = (label, fn) => { snapshot(label); fn(); paint(); queueSave(); };
  // Drafts are kept as you go.
  const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveGuide(pattern, guide.size_id, tree, guide.status === 'ready' ? 'ready' : 'draft'), 600); };

  function findBlock(id) {
    for (const p of tree.pieces) for (const s of p.sections) { const i = s.blocks.findIndex((b) => b.id === id); if (i >= 0) return { piece: p, section: s, list: s.blocks, i, b: s.blocks[i] }; }
    return null;
  }
  const move = (list, i, d) => { const j = i + d; if (j < 0 || j >= list.length) return false; [list[i], list[j]] = [list[j], list[i]]; return true; };

  function paint() {
    const c = counts(tree);
    const flat = flatten(tree);
    const range = (b) => { const f = flat.find((x) => x.block.id === b.id); return f && f.rows ? (f.start === f.end ? `Row ${f.start}` : `Rows ${f.start}–${f.end}`) : ''; };
    const u = undo[undo.length - 1]; const r = redo[redo.length - 1];
    root.innerHTML = `
      <header class="ged-head">
        <div class="ged-head__bar">
          <a class="icon-btn icon-btn--round" href="${back}" aria-label="Close">${icons.close}</a>
          <button type="button" class="pill-btn" data-undo ${u ? '' : 'disabled'}>${icons.undo}<span><strong>Undo</strong><small>${esc(u ? u.label : 'Nothing to undo')}</small></span></button>
          <button type="button" class="pill-btn" data-redo ${r ? '' : 'disabled'}>${icons.redo}<span><strong>Redo</strong><small>${esc(r ? r.label : 'Nothing to redo')}</small></span></button>
        </div>
        <h1 class="ged-head__title">${esc(pattern.name)}</h1>
        <span class="ged-head__size">Size ${esc(sizeName)}</span>
      </header>
      <main class="ged">
        <div class="ged-counts">
          <span class="count-chip count-chip--blue">${c.pieces} ${c.pieces === 1 ? 'piece' : 'pieces'}</span>
          <span class="count-chip count-chip--pink">${c.sections} ${c.sections === 1 ? 'section' : 'sections'}</span>
          <span class="count-chip count-chip--butter">${c.blocks} ${c.blocks === 1 ? 'step' : 'steps'}</span>
        </div>
        <p class="ged-hint">Tap a step to change it. Use the arrows to move things up or down. ${totalRows(tree)} rows in all.</p>
        ${tree.pieces.map((p, pi) => `
          <section class="ged-piece" data-piece="${p.id}">
            <div class="ged-card ged-card--piece">
              <span class="ged-card__text"><strong>${esc(pieceLabel(p))}</strong><small>${p.sections.length} ${p.sections.length === 1 ? 'section' : 'sections'}${(p.times || 1) > 1 ? ` · worked ${p.times} times` : ''}</small></span>
              <span class="kind-tag kind-tag--piece">Piece</span>
              <button type="button" class="icon-btn icon-btn--small" data-piece-menu="${p.id}" aria-label="Piece options">${icons.more}</button>
            </div>
            ${p.sections.map((s) => `
              <div class="ged-section" data-section="${s.id}">
                <div class="ged-card ged-card--section">
                  <span class="ged-card__text"><strong>${esc(s.name)}</strong><small>${s.blocks.length} ${s.blocks.length === 1 ? 'step' : 'steps'}</small></span>
                  <span class="kind-tag kind-tag--section">Section</span>
                  <button type="button" class="icon-btn icon-btn--small" data-section-menu="${s.id}" aria-label="Section options">${icons.more}</button>
                </div>
                ${s.blocks.map((b, bi) => `
                  <div class="ged-block" data-block="${b.id}">
                    <button type="button" class="ged-card ged-card--block" data-edit="${b.id}">
                      <span class="ged-card__text"><strong>${esc(b.title || KIND_LABEL[b.kind])}</strong><small>${esc(blockSummary(b))}${range(b) ? ` · ${range(b)}` : ''}</small></span>
                      <span class="kind-tag kind-tag--${b.kind}">${KIND_LABEL[b.kind] || b.kind}</span>
                    </button>
                    <span class="ged-move">
                      <button type="button" class="icon-btn icon-btn--small" data-up="${b.id}" ${bi === 0 ? 'disabled' : ''} aria-label="Move up">${icons.up}</button>
                      <button type="button" class="icon-btn icon-btn--small" data-down="${b.id}" ${bi === s.blocks.length - 1 ? 'disabled' : ''} aria-label="Move down">${icons.down}</button>
                    </span>
                  </div>`).join('')}
                <button type="button" class="add-dash" data-add-block="${s.id}">${icons.plusCircle}<span>Add a step</span></button>
              </div>`).join('')}
            <button type="button" class="add-dash add-dash--section" data-add-section="${p.id}">${icons.plusCircle}<span>Add a section to ${esc(p.name)}</span></button>
            ${pi === tree.pieces.length - 1 ? '' : '<hr class="ged-sep">'}
          </section>`).join('')}
        <button type="button" class="add-dash add-dash--piece" data-add-piece>${icons.plusCircle}<span>Add a piece</span></button>
      </main>
      <footer class="ged-foot">
        ${pattern.pdf_file_id ? `<a class="btn btn--secondary" href="#/pdf/${pattern.id}">${icons.file}<span>View PDF</span></a>` : ''}
        ${(pattern.source_groups || []).length ? `<button type="button" class="btn btn--secondary" data-rebuild aria-label="Rebuild from the PDF">${icons.repeat}<span>Rebuild</span></button>` : ''}
        <button type="button" class="btn btn--butter" data-review>Continue to review</button>
      </footer>`;
  }

  /* ---------- block sheet ---------- */

  function editBlock(id) {
    const at = findBlock(id);
    if (!at) return;
    const b = JSON.parse(JSON.stringify(at.b));
    const body = el('<form class="block-form" novalidate></form>');
    const sheet = openSheet({ title: 'Edit step', body, className: 'sheet--tall' });
    const kinds = Object.entries(KIND_LABEL);
    const paintForm = () => {
      const rows = b.rows || [];
      body.innerHTML = `
        <label class="field"><span class="field__label">Name</span><input class="input" name="title" value="${esc(b.title || '')}" maxlength="60"></label>
        <div class="field"><span class="field__label">Kind</span><div class="chips chips--small">${kinds.map(([k, l]) => `<button type="button" class="chip ${b.kind === k ? 'is-on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div></div>
        ${b.kind === 'repeat' ? `<label class="field"><span class="field__label">How many times</span><input class="input" name="times" inputmode="numeric" pattern="[0-9]*" value="${b.times || 1}"></label>` : ''}
        ${b.kind === 'measure' ? `
          <label class="field"><span class="field__label">Work until it measures</span><input class="input" name="target" value="${esc(b.target || '')}" placeholder="e.g. 30 cm / 12 in"></label>
          <div class="pform__two">
            <label class="field"><span class="field__label">Count something too (optional)</span><input class="input" name="tally_label" value="${esc(b.tally_label || '')}" placeholder="e.g. Decreases"></label>
            <label class="field"><span class="field__label">How many</span><input class="input" name="tally_target" inputmode="numeric" pattern="[0-9]*" value="${b.tally_target || ''}"></label>
          </div>` : ''}
        ${b.kind === 'bind_off' ? `<label class="field"><span class="field__label">Method</span><input class="input" name="method" value="${esc(b.method || '')}" placeholder="e.g. Italian, stretchy"></label>` : ''}
        ${b.kind === 'cast_on' || b.kind === 'pick_up' ? `<div class="pform__two">
          <label class="field"><span class="field__label">Stitches</span><input class="input" name="stitches" inputmode="numeric" pattern="[0-9]*" value="${b.stitches || ''}"></label>
          ${b.kind === 'cast_on' ? `<label class="field"><span class="field__label">Method</span><input class="input" name="method" value="${esc(b.method || '')}" placeholder="e.g. long-tail"></label>` : ''}</div>` : ''}
        ${b.kind === 'rows' || b.kind === 'repeat' ? `
          <div class="field"><span class="field__label">Rows</span>
            <div class="row-edit-list">${rows.map((r, i) => `
              <div class="row-edit" data-row="${i}">
                <div class="row-edit__head"><strong>Row ${r.n}</strong>
                  <span class="chips chips--tiny">${['', 'RS', 'WS'].map((sd) => `<button type="button" class="chip ${r.side === sd ? 'is-on' : ''}" data-side="${sd}">${sd || 'Either'}</button>`).join('')}</span>
                  <button type="button" class="icon-btn icon-btn--small" data-del-row aria-label="Delete row">${icons.trash}</button></div>
                <textarea class="input input--area input--short" data-row-text>${esc(r.text)}</textarea>
                ${r.same_as ? `<small class="hint">Same as row ${r.same_as}</small>` : ''}
              </div>`).join('')}</div>
            <button type="button" class="btn btn--secondary btn--small" data-add-row>${icons.plus}<span>Add a row</span></button></div>` : `
          <label class="field"><span class="field__label">Instruction</span><textarea class="input input--area" name="text">${esc(b.text || '')}</textarea></label>`}
        <label class="field"><span class="field__label">Note</span><textarea class="input input--area input--short" name="note">${esc(b.note || '')}</textarea></label>
        <label class="field"><span class="field__label">Stitch check after this step</span><input class="input" name="check" value="${esc(b.check || '')}" placeholder="e.g. 66 sts on the needles"></label>
        <div class="block-form__actions">
          <button type="button" class="btn btn--danger-soft" data-del-block>${icons.trash}<span>Delete step</span></button>
          <button type="submit" class="btn btn--butter">Save step</button>
        </div>`;
    };
    paintForm();
    body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.name === 'times') b.times = Math.max(1, parseInt(t.value, 10) || 1);
      else if (t.name === 'tally_target') b.tally_target = parseInt(t.value, 10) || null;
      else if (t.name === 'stitches') b.stitches = parseInt(t.value, 10) || 0;
      else if (t.name) b[t.name] = t.value;
      if (t.matches('[data-row-text]')) { const r = b.rows[+t.closest('[data-row]').dataset.row]; r.text = t.value; delete r.same_as; }
    });
    body.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-kind]');
      if (k) {
        b.kind = k.dataset.kind;
        if ((b.kind === 'rows' || b.kind === 'repeat') && !b.rows) b.rows = [{ n: 1, side: '', text: b.text || '' }];
        if (b.kind === 'repeat' && !b.times) b.times = 2;
        paintForm(); return;
      }
      const sd = e.target.closest('[data-side]');
      if (sd) { b.rows[+sd.closest('[data-row]').dataset.row].side = sd.dataset.side; paintForm(); return; }
      if (e.target.closest('[data-del-row]')) { b.rows.splice(+e.target.closest('[data-row]').dataset.row, 1); b.rows.forEach((r, i) => { r.n = i + 1; }); paintForm(); return; }
      if (e.target.closest('[data-add-row]')) { b.rows = [...(b.rows || []), { n: (b.rows || []).length + 1, side: '', text: '' }]; paintForm(); return; }
      if (e.target.closest('[data-del-block]')) {
        const ok = await confirmDialog({ title: 'Delete this step?', message: `“${b.title || KIND_LABEL[b.kind]}” is removed from the guide. You can undo this.`, ok: 'Delete', danger: true });
        if (!ok) return;
        sheet.close();
        commit(`Delete ${b.title || 'step'}`, () => { const a = findBlock(id); a.list.splice(a.i, 1); });
      }
    });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      sheet.close();
      commit(`Edit ${b.title || 'step'}`, () => { const a = findBlock(id); a.list[a.i] = b; });
    });
  }

  function menu(title, items) {
    const sheet = openSheet({ title, body: `<div class="menu-list">${items.map(([k, label, icon]) => `<button type="button" class="menu-item" data-m="${k}">${icon || ''}<span>${esc(label)}</span></button>`).join('')}</div>` });
    return new Promise((resolve) => {
      let pick = null;
      sheet.body.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { pick = b.dataset.m; sheet.close(); } });
      const t = setInterval(() => { if (!sheet.root.isConnected) { clearInterval(t); resolve(pick); } }, 120);
    });
  }

  async function sectionMenu(id) {
    const piece = tree.pieces.find((p) => p.sections.some((s) => s.id === id));
    const i = piece.sections.findIndex((s) => s.id === id);
    const s = piece.sections[i];
    const m = await menu(s.name, [['rename', 'Rename', icons.pencil], ['up', 'Move up', icons.up], ['down', 'Move down', icons.down], ['delete', 'Delete section', icons.trash]]);
    if (m === 'rename') { const n = await promptDialog({ title: 'Rename section', label: 'Name', value: s.name, maxlength: 60 }); if (n) commit(`Rename ${n}`, () => { s.name = n; }); }
    if (m === 'up') commit(`Move ${s.name}`, () => move(piece.sections, i, -1));
    if (m === 'down') commit(`Move ${s.name}`, () => move(piece.sections, i, 1));
    if (m === 'delete' && await confirmDialog({ title: `Delete “${s.name}”?`, message: 'The section and its steps are removed. You can undo this.', ok: 'Delete', danger: true })) {
      commit(`Delete ${s.name}`, () => piece.sections.splice(i, 1));
    }
  }
  async function pieceMenu(id) {
    const i = tree.pieces.findIndex((p) => p.id === id);
    const p = tree.pieces[i];
    const m = await menu(p.name, [['rename', 'Rename', icons.pencil], ['times', 'Worked how many times', icons.repeat], ['up', 'Move up', icons.up], ['down', 'Move down', icons.down], ['delete', 'Delete piece', icons.trash]]);
    if (m === 'rename') { const n = await promptDialog({ title: 'Rename piece', label: 'Name', value: p.name, maxlength: 60 }); if (n) commit(`Rename ${n}`, () => { p.name = n; }); }
    if (m === 'times') {
      const n = await promptDialog({ title: `How many times is ${p.name} worked?`, label: 'Times (e.g. 2 for two sleeves)', value: String(p.times || 1), numeric: true, maxlength: 2 });
      const v = Math.max(1, Math.min(20, parseInt(n, 10) || 0));
      if (n !== null && v) commit(`${p.name} x${v}`, () => { p.times = v; });
    }
    if (m === 'up') commit(`Move ${p.name}`, () => move(tree.pieces, i, -1));
    if (m === 'down') commit(`Move ${p.name}`, () => move(tree.pieces, i, 1));
    if (m === 'delete' && await confirmDialog({ title: `Delete “${p.name}”?`, message: 'The piece and everything in it are removed. You can undo this.', ok: 'Delete', danger: true })) {
      commit(`Delete ${p.name}`, () => tree.pieces.splice(i, 1));
    }
  }

  function review() {
    const c = counts(tree);
    const sheet = openSheet({
      title: 'Review your guide',
      body: `<div class="review">
        <p class="review__big">${totalRows(tree)} rows</p>
        <p class="settings__p">${c.pieces} ${c.pieces === 1 ? 'piece' : 'pieces'} · ${c.sections} ${c.sections === 1 ? 'section' : 'sections'} · ${c.blocks} steps · size ${esc(sizeName)}</p>
        <ol class="review__list">${flatten(tree).map((f) => `<li><strong>${esc(f.block.title || KIND_LABEL[f.block.kind])}</strong><span>${esc(blockSummary(f.block))}${f.rows ? ` · rows ${f.start}–${f.end}` : ''}</span></li>`).join('')}</ol>
        <button type="button" class="btn btn--butter btn--block" data-save>${icons.check}<span>Save guide</span></button>
        <button type="button" class="btn btn--text btn--block" data-keep>Keep editing</button></div>`,
      className: 'sheet--tall',
    });
    sheet.body.addEventListener('click', async (e) => {
      if (e.target.closest('[data-keep]')) sheet.close();
      if (e.target.closest('[data-save]')) {
        clearTimeout(saveTimer);
        saveTimer = null;
        guide.status = 'ready';
        await saveGuide(pattern, guide.size_id, tree, 'ready');
        // A linked project's goal becomes the guide's row total.
        if (projectId) {
          const counters = await db.byIndex('counters', 'project_id', projectId);
          const main = counters.find((x) => x.is_main);
          if (main && main.target !== totalRows(tree)) { main.target = totalRows(tree); await db.put('counters', main); }
        }
        sheet.close();
        toast('Guide saved');
        location.hash = back;
      }
    });
  }

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const hit = (s) => t.closest(s);
    if (hit('[data-undo]')) { const u = undo.pop(); if (u) { redo.push({ tree: JSON.stringify(tree), label: u.label }); tree = JSON.parse(u.tree); paint(); queueSave(); } }
    else if (hit('[data-redo]')) { const r = redo.pop(); if (r) { undo.push({ tree: JSON.stringify(tree), label: r.label }); tree = JSON.parse(r.tree); paint(); queueSave(); } }
    else if (hit('[data-edit]')) editBlock(hit('[data-edit]').dataset.edit);
    else if (hit('[data-up]') || hit('[data-down]')) {
      const id = (hit('[data-up]') || hit('[data-down]')).dataset[hit('[data-up]') ? 'up' : 'down'];
      const a = findBlock(id);
      commit(`Move ${a.b.title || 'step'}`, () => move(a.list, a.i, hit('[data-up]') ? -1 : 1));
    }
    else if (hit('[data-add-block]')) {
      const s = tree.pieces.flatMap((p) => p.sections).find((x) => x.id === hit('[data-add-block]').dataset.addBlock);
      const nb = { id: nid('b'), kind: 'rows', title: 'New step', note: '', check: '', rows: [{ n: 1, side: '', text: '' }] };
      commit('Add a step', () => s.blocks.push(nb));
      editBlock(nb.id);
    }
    else if (hit('[data-add-section]')) {
      const p = tree.pieces.find((x) => x.id === hit('[data-add-section]').dataset.addSection);
      const n = await promptDialog({ title: 'New section', label: 'Name', value: '', placeholder: 'e.g. Ribbing', maxlength: 60 });
      if (n) commit(`Add ${n}`, () => p.sections.push({ id: nid('s'), name: n, blocks: [] }));
    }
    else if (hit('[data-add-piece]')) {
      const n = await promptDialog({ title: 'New piece', label: 'Name', value: '', placeholder: 'e.g. Sleeves', maxlength: 60 });
      if (n) commit(`Add ${n}`, () => tree.pieces.push({ id: nid('p'), name: n, sections: [{ id: nid('s'), name: 'Section 1', blocks: [] }] }));
    }
    else if (hit('[data-section-menu]')) sectionMenu(hit('[data-section-menu]').dataset.sectionMenu);
    else if (hit('[data-piece-menu]')) pieceMenu(hit('[data-piece-menu]').dataset.pieceMenu);
    else if (hit('[data-review]')) review();
    else if (hit('[data-rebuild]')) {
      const plan = await planRebuild(pattern, guide.size_id);
      const { measured, tallies } = plan.lost;
      const lostText = measured || tallies
        ? ` Some counts belong to steps that won’t be in the rebuilt guide (${[measured ? `${measured} measured ${measured === 1 ? 'row' : 'rows'}` : '', tallies ? `${tallies} tallied ${tallies === 1 ? 'step' : 'steps'}` : ''].filter(Boolean).join(', ')}). They will be kept aside and no longer counted.`
        : '';
      const ok = await confirmDialog({
        title: 'Rebuild from the PDF?',
        message: `The guide is read again from the pattern PDF with the newest reader. Changes you made here by hand will be replaced. Projects keep their place by rows done.${lostText}`,
        ok: 'Rebuild', danger: true, cancel: 'Keep my guide',
      });
      if (!ok) return;
      clearTimeout(saveTimer); saveTimer = null;
      const g = await rebuildGuide(pattern, guide.size_id, plan.tree);
      if (!g) { toast('Nothing could be read from the PDF for this size.'); return; }
      snapshot('Rebuild from PDF');
      tree = JSON.parse(JSON.stringify(g.tree));
      guide.status = 'ready';
      paint();
      toast('Guide read again from the PDF');
    }
  });

  paint();
  return () => { if (saveTimer) { clearTimeout(saveTimer); saveGuide(pattern, guide.size_id, tree, guide.status === 'ready' ? 'ready' : 'draft'); } void lastLabel; };
}
