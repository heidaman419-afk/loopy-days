// New project (#/project-new[/<draftId>]) and Edit project (#/project-edit/<id>). Full screen.
// A new form is kept as a draft as soon as something is typed, so nothing is lost
// if the knitter leaves; it appears as "Continue setting up" on the Projects tab.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { confirmDialog, toast } from '../ui/overlay.js';
import {
  getProject, newProjectRecord, mainCounterOf, deleteProject, STATUSES, CRAFTS, statusOf, craftOf, localDate,
} from '../data/projects.js';
import { newCounter } from '../data/counters.js';
import { addPhoto, thumbUrl, deletePhoto } from '../data/photos.js';
import { pickPhoto, withPhotoBusy } from '../ui/photo-picker.js';

export const fullscreen = true;

export function editMount(root, params) { return mount(root, params, true); }

export async function mount(root, params, editing = false) {
  let project = params[0] ? await db.get('projects', params[0]) : null;
  if (project && project.deleted) project = null;
  if (editing && !project) { location.hash = '#/projects'; return; }
  if (!editing && project && !project.draft) { location.hash = `#/project/${project.id}`; return; }
  const main = project ? await mainCounterOf(project.id) : null;

  const v = {
    name: project ? project.name || '' : '',
    craft: project ? craftOf(project) : 'knitting',
    status: project ? statusOf(project) : 'not_started',
    start_date: project ? project.start_date || '' : '',
    target: project && project.draft ? (project.draft_target || '') : (main && main.target) || '',
    notes: project ? project.notes || '' : '',
    cover: project ? project.cover_photo_id || null : null,
  };

  const chips = (name, list, value) => list.map(([k, label]) =>
    `<button type="button" class="chip ${value === k ? 'is-on' : ''}" data-${name}="${k}" aria-pressed="${value === k}">${esc(label)}</button>`).join('');

  root.innerHTML = `
    <header class="form-top">
      <button type="button" class="btn btn--text btn--small" data-cancel>${editing ? 'Cancel' : 'Close'}</button>
      <h1 class="form-top__title">${editing ? 'Edit project' : 'New project'}</h1>
      <span class="form-top__side"></span>
    </header>
    <form class="pform" novalidate autocomplete="off">
      <p class="draft-note" data-draft-note ${!editing && project ? '' : 'hidden'}>${icons.check}<span>Saved as a draft while you fill this in.</span></p>

      <label class="field">
        <span class="field__label">Name <span class="req">(needed)</span></span>
        <input class="input" name="name" type="text" maxlength="60" autocapitalize="words" enterkeyhint="next"
          placeholder="e.g. Cosy autumn cardigan" value="${esc(v.name)}" required>
        <span class="field__error" data-name-error hidden>Give your project a name first.</span>
      </label>

      <div class="field"><span class="field__label">Craft</span>
        <div class="chips">${chips('craft', CRAFTS, v.craft)}</div></div>

      <div class="field"><span class="field__label">Status</span>
        <div class="chips">${chips('status', STATUSES, v.status)}</div></div>

      <div class="pform__two">
        <label class="field">
          <span class="field__label">Start date</span>
          <input class="input" name="start_date" type="date" value="${esc(v.start_date)}">
        </label>
        <label class="field">
          <span class="field__label">Row goal</span>
          <input class="input" name="target" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="Optional" value="${esc(String(v.target || ''))}">
        </label>
      </div>

      <label class="field">
        <span class="field__label">Notes</span>
        <textarea class="input input--area" name="notes" rows="4" maxlength="4000"
          placeholder="Needle size, who it’s for, anything to remember">${esc(v.notes)}</textarea>
      </label>

      <div class="field"><span class="field__label">Cover photo</span>
        <div data-cover-box></div></div>

      <button class="btn btn--butter btn--block pform__save" type="submit">${editing ? 'Save changes' : 'Create project'}</button>
      ${editing ? `<button type="button" class="btn btn--danger-soft btn--block" data-delete>${icons.trash}<span>Delete project</span></button>` : ''}
    </form>`;

  const form = root.querySelector('form');
  const coverBox = root.querySelector('[data-cover-box]');

  /* ---------- cover photo ---------- */

  async function paintCover() {
    if (!v.cover) {
      coverBox.innerHTML = `<button type="button" class="dash-box dash-box--small" data-add-cover>${icons.camera}<strong>Add a cover photo</strong><span>Optional. You can add more photos later.</span></button>`;
      return;
    }
    const u = await thumbUrl(v.cover);
    coverBox.innerHTML = `
      <div class="cover-pick">
        ${u ? `<img src="${u}" alt="Cover photo">` : '<span class="cover-pick__wait">Photo saved</span>'}
        <div class="cover-pick__actions">
          <button type="button" class="btn btn--secondary btn--small" data-add-cover>${icons.camera}<span>Change</span></button>
          <button type="button" class="btn btn--text btn--small" data-remove-cover>Remove</button>
        </div>
      </div>`;
  }

  /* ---------- drafts ---------- */

  const hasContent = () => !!(form.name.value.trim() || form.notes.value.trim() || form.target.value || form.start_date.value || v.cover);
  let draftTimer = null;
  let saved = false;

  function readForm() {
    v.name = form.name.value.trim();
    v.start_date = form.start_date.value || '';
    v.target = form.target.value.replace(/\D/g, '');
    v.notes = form.notes.value;
  }

  async function saveDraft() {
    if (editing || saved) return;
    readForm();
    if (!project && !hasContent()) return;
    if (!project) project = newProjectRecord({ draft: true });
    Object.assign(project, {
      name: v.name, craft: v.craft, status: v.status, start_date: v.start_date || null,
      notes: v.notes, cover_photo_id: v.cover, draft_target: v.target ? +v.target : null, draft: true,
    });
    await db.put('projects', project);
    root.querySelector('[data-draft-note]').hidden = false;
    if (location.hash !== `#/project-new/${project.id}`) history.replaceState(null, '', `#/project-new/${project.id}`);
  }
  const queueDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 500); };

  /* ---------- events ---------- */

  form.addEventListener('input', (e) => {
    if (e.target.name === 'target') e.target.value = e.target.value.replace(/\D/g, '');
    if (e.target.name === 'name') root.querySelector('[data-name-error]').hidden = true;
    queueDraft();
  });
  form.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-craft]');
    const s = e.target.closest('[data-status]');
    for (const [hit, key, attr] of [[c, 'craft', 'data-craft'], [s, 'status', 'data-status']]) {
      if (!hit) continue;
      v[key] = hit.getAttribute(attr);
      for (const b of form.querySelectorAll(`[${attr}]`)) {
        const on = b === hit; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on);
      }
      queueDraft();
    }
    if (e.target.closest('[data-add-cover]')) {
      pickPhoto(async (file) => {
        readForm();
        if (!project) { project = newProjectRecord({ draft: !editing }); if (!editing) await saveDraftNow(); }
        const ph = await withPhotoBusy(() => addPhoto(project.id, file));
        if (!ph) return;
        v.cover = ph.id;
        if (editing) { project.cover_photo_id = ph.id; await db.put('projects', project); } else await saveDraftNow();
        paintCover();
      }, { title: 'Add a cover photo' });
    }
    if (e.target.closest('[data-remove-cover]')) {
      v.cover = null;
      paintCover();
      queueDraft();
    }
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({
        title: `Delete “${project.name || 'this project'}”?`,
        message: 'Its counter, row notes and photos will be removed from all your devices. Time you knitted stays in your activity.',
        ok: 'Delete project', danger: true,
      });
      if (!ok) return;
      await deleteProject(project.id);
      saved = true;
      toast('Project deleted');
      location.hash = '#/projects';
    }
  });
  async function saveDraftNow() { clearTimeout(draftTimer); await saveDraft(); }

  root.querySelector('[data-cancel]').addEventListener('click', async () => {
    if (!editing && !saved) {
      await saveDraftNow();
      if (project && hasContent()) toast('Kept as a draft. Find it under “Continue setting up”.');
    }
    saved = true;
    location.hash = editing ? `#/project/${project.id}` : '#/projects';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readForm();
    if (!v.name) {
      root.querySelector('[data-name-error]').hidden = false;
      form.name.focus();
      return;
    }
    clearTimeout(draftTimer);
    saved = true;
    const p = project || newProjectRecord();
    const wasNew = !!p.draft || !project;
    Object.assign(p, {
      name: v.name, craft: v.craft, status: v.status, start_date: v.start_date || null,
      notes: v.notes, cover_photo_id: v.cover, draft: false,
    });
    delete p.draft_target;
    if (p.status === 'finished' && !p.finished_date) p.finished_date = localDate();
    if (p.status !== 'finished') p.finished_date = null;
    if (p.status === 'in_progress' && !p.start_date) p.start_date = localDate();
    const entries = [['projects', p]];
    let counter = await mainCounterOf(p.id);
    if (!counter) counter = newCounter(p.id, { is_main: true, name: 'Rows' });
    const target = v.target ? +v.target : null;
    if ((counter.target || null) !== target || !counter.created_at) {
      counter.target = target;
      entries.push(['counters', counter]);
    }
    if (v.cover === null && project && project.cover_photo_id) { /* cover removed: photo itself stays in the project */ }
    await db.putMany(entries);
    toast(wasNew ? 'Project created' : 'Changes saved');
    location.replace(`#/project/${p.id}`);
  });

  paintCover();
  if (!editing && !project) requestAnimationFrame(() => form.name.focus());

  return () => {
    // Leaving any other way (tab, back gesture): keep what was typed as a draft.
    if (!editing && !saved && hasContent()) { clearTimeout(draftTimer); saveDraft(); }
  };
}
