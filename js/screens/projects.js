// Projects tab (#/projects): search, filter, sort, drafts and a 2-column grid of cards.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc, timeAgo } from '../ui/dom.js';
import { openSheet, confirmDialog, toast } from '../ui/overlay.js';
import { basket, ring } from '../ui/illustrations.js';
import {
  listProjects, mainCounterOf, progressOf, lastWorked, statusOf, statusLabel, craftOf,
  STATUSES, CRAFTS, deleteProject,
} from '../data/projects.js';
import { thumbUrl, addPhoto } from '../data/photos.js';
import { pickPhoto, withPhotoBusy } from '../ui/photo-picker.js';
import { openTour, shouldShowTour } from './tour.js';

const VIEW_KEY = 'ld-projects-view'; // this device's filter/sort choice
const SORTS = [['last', 'Last worked'], ['newest', 'Newest'], ['name', 'Name A–Z'], ['progress', 'Progress']];

function loadView() {
  try { return { status: 'all', craft: 'all', sort: 'last', ...JSON.parse(localStorage.getItem(VIEW_KEY)) }; } catch { return { status: 'all', craft: 'all', sort: 'last' }; }
}
const saveView = (v) => localStorage.setItem(VIEW_KEY, JSON.stringify({ status: v.status, craft: v.craft, sort: v.sort }));

export async function mount(root) {
  const view = loadView();
  let query = '';
  let items = [];   // [{ p, main, pct, worked }]
  let drafts = [];

  root.innerHTML = `
    <header class="wave-head wave-head--tall">
      <div class="wave-head__bar">
        <div class="wave-head__side">
          <button type="button" class="icon-btn icon-btn--round" data-help aria-label="How projects work">${icons.help}</button>
        </div>
        <div class="wave-head__brand">${basket(50)}</div>
        <div class="wave-head__side wave-head__side--right">
          <a class="icon-btn icon-btn--round" href="#/project-new" aria-label="Start a new project">${icons.plus}</a>
        </div>
      </div>
      <h1 class="wave-head__title">Your projects</h1>
      <div class="search-row">
        <label class="search">
          ${icons.search}
          <input type="search" placeholder="Search projects" aria-label="Search projects" data-search
            autocomplete="off" autocapitalize="off" enterkeyhint="search">
        </label>
        <button type="button" class="icon-btn icon-btn--box" data-filter aria-label="Filter projects">${icons.filter}<span class="dot" data-filter-dot hidden></span></button>
        <button type="button" class="icon-btn icon-btn--box" data-sort aria-label="Sort projects">${icons.sort}</button>
      </div>
      <svg class="wave-head__wave" viewBox="0 0 390 34" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0H390V16C352 26 318 30 268 22 212 13 170 4 118 10 70 15 34 30 0 22Z"/>
      </svg>
    </header>
    <main class="page projects-page">
      <section data-drafts></section>
      <p class="list-note" data-note hidden></p>
      <div class="pgrid" data-grid></div>
      <section class="empty" data-empty hidden>
        <div class="empty__art empty__art--plain" aria-hidden="true">${basket(96)}</div>
        <h2 class="empty__title">Nothing on the needles yet</h2>
        <p class="empty__text">Give your next make a home: its own row counter, timer, photos and notes.</p>
        <a class="btn btn--butter" href="#/project-new">${icons.plus}<span>Start a project</span></a>
      </section>
    </main>`;

  const $ = (s) => root.querySelector(s);
  const grid = $('[data-grid]');

  /* ---------- data ---------- */

  async function load() {
    const projects = await listProjects();
    items = await Promise.all(projects.map(async (p) => {
      const main = await mainCounterOf(p.id);
      return { p, main, pct: progressOf(p, main), worked: lastWorked(p, main) };
    }));
    drafts = (await listProjects({ drafts: true })).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  function visible() {
    const q = query.trim().toLowerCase();
    let list = items.filter(({ p }) =>
      (view.status === 'all' || statusOf(p) === view.status)
      && (view.craft === 'all' || craftOf(p) === view.craft)
      && (!q || (p.name || '').toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q)));
    const by = {
      last: (a, b) => (b.worked || b.p.created_at || '').localeCompare(a.worked || a.p.created_at || ''),
      newest: (a, b) => (b.p.created_at || '').localeCompare(a.p.created_at || ''),
      name: (a, b) => (a.p.name || '').localeCompare(b.p.name || '', undefined, { sensitivity: 'base' }),
      progress: (a, b) => b.pct - a.pct || (a.p.name || '').localeCompare(b.p.name || ''),
    }[view.sort] || (() => 0);
    return list.sort(by);
  }

  /* ---------- painting ---------- */

  function paintDrafts() {
    const box = $('[data-drafts]');
    if (!drafts.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <h2 class="group-label">Continue setting up</h2>
      <div class="drafts">
        ${drafts.map((d) => `
          <div class="draft" data-id="${d.id}">
            <a class="draft__link" href="#/project-new/${d.id}">
              <span class="draft__icon">${icons.pencil}</span>
              <span class="draft__text"><strong>${esc(d.name || 'Untitled project')}</strong>
                <span>Started setting up ${esc(timeAgo(d.updated_at))}</span></span>
              <span class="draft__go">${icons.chevronRight}</span>
            </a>
            <button type="button" class="icon-btn icon-btn--small" data-del-draft aria-label="Delete this draft">${icons.trash}</button>
          </div>`).join('')}
      </div>`;
  }

  function cardHTML({ p, pct, worked }) {
    const st = statusOf(p);
    const sub = st === 'not_started' && !worked ? 'Not started yet' : worked ? `Last worked ${timeAgo(worked)}` : 'No knitting logged yet';
    return `
      <article class="pcard" data-status="${st}" data-id="${p.id}">
        <div class="pcard__media knit-texture">
          ${p.cover_photo_id ? `<img class="pcard__cover" data-thumb="${p.cover_photo_id}" alt="" hidden>` : ''}
          ${p.cover_photo_id ? '' : `<button type="button" class="pcard__add" data-add-photo>${icons.camera}<span>Add photo</span></button>`}
          <span class="status-badge" data-status="${st}">${statusLabel(st)}</span>
        </div>
        ${ring(pct, { size: 56, stroke: 5, cls: 'pcard__ring' })}
        <div class="pcard__body">
          <h3 class="pcard__name">${esc(p.name || 'Untitled project')}</h3>
          <p class="pcard__meta">${esc(sub)}</p>
        </div>
        <a class="pcard__link" href="#/project/${p.id}" aria-label="Open ${esc(p.name || 'project')}"></a>
      </article>`;
  }

  async function paintThumbs() {
    for (const img of grid.querySelectorAll('[data-thumb]')) {
      const u = await thumbUrl(img.dataset.thumb);
      if (u && img.isConnected) { img.src = u; img.hidden = false; }
    }
  }

  function paint() {
    paintDrafts();
    const list = visible();
    const filtered = view.status !== 'all' || view.craft !== 'all';
    $('[data-filter-dot]').hidden = !filtered;
    $('[data-empty]').hidden = items.length > 0;
    const note = $('[data-note]');
    if (items.length && !list.length) {
      note.hidden = false;
      note.innerHTML = `No projects match${query ? ` “${esc(query)}”` : ''}${filtered ? ' with these filters' : ''}. <button type="button" class="link-btn" data-clear>Show all projects</button>`;
    } else note.hidden = true;
    grid.innerHTML = list.map(cardHTML).join('');
    paintThumbs();
  }

  async function refresh() {
    await load();
    if (root.isConnected) paint();
  }

  /* ---------- events ---------- */

  $('[data-search]').addEventListener('input', (e) => { query = e.target.value; paint(); });
  $('[data-help]').addEventListener('click', () => openTour());
  $('[data-filter]').addEventListener('click', openFilter);
  $('[data-sort]').addEventListener('click', openSort);

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-clear]')) {
      query = ''; $('[data-search]').value = '';
      view.status = 'all'; view.craft = 'all'; saveView(view); paint(); return;
    }
    const add = e.target.closest('[data-add-photo]');
    if (add) {
      e.preventDefault();
      const id = add.closest('.pcard').dataset.id;
      pickPhoto(async (file) => {
        await withPhotoBusy(async () => {
          const ph = await addPhoto(id, file);
          const p = await db.get('projects', id);
          if (p && !p.cover_photo_id) { p.cover_photo_id = ph.id; await db.put('projects', p); }
        });
        refresh();
      }, { title: 'Add a cover photo' });
      return;
    }
    const del = e.target.closest('[data-del-draft]');
    if (del) {
      const id = del.closest('.draft').dataset.id;
      const d = drafts.find((x) => x.id === id);
      const ok = await confirmDialog({
        title: 'Delete this draft?',
        message: `“${d && d.name ? d.name : 'Untitled project'}” hasn’t been saved as a project yet. It will be thrown away.`,
        ok: 'Delete draft', danger: true,
      });
      if (!ok) return;
      await deleteProject(id);
      toast('Draft deleted');
      refresh();
    }
  });

  function openFilter() {
    const chips = (name, list, value) => [['all', 'All'], ...list].map(([k, label]) =>
      `<button type="button" class="chip ${value === k ? 'is-on' : ''}" data-${name}="${k}" aria-pressed="${value === k}">${esc(label)}</button>`).join('');
    const sheet = openSheet({
      title: 'Show projects',
      body: `<div class="settings">
        <section class="settings__group"><h3 class="settings__h4">Status</h3><div class="chips" data-chips="status">${chips('status', STATUSES, view.status)}</div></section>
        <section class="settings__group"><h3 class="settings__h4">Craft</h3><div class="chips" data-chips="craft">${chips('craft', CRAFTS, view.craft)}</div></section>
        <div class="sheet-actions">
          <button type="button" class="btn btn--text" data-reset>Show everything</button>
          <button type="button" class="btn btn--butter" data-done>Done</button>
        </div></div>`,
    });
    const b = sheet.body;
    const sync = () => {
      for (const c of b.querySelectorAll('[data-status]')) { const on = c.dataset.status === view.status; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on); }
      for (const c of b.querySelectorAll('[data-craft]')) { const on = c.dataset.craft === view.craft; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on); }
      saveView(view); paint();
    };
    b.addEventListener('click', (e) => {
      const s = e.target.closest('[data-status]'); if (s) { view.status = s.dataset.status; sync(); }
      const c = e.target.closest('[data-craft]'); if (c) { view.craft = c.dataset.craft; sync(); }
      if (e.target.closest('[data-reset]')) { view.status = 'all'; view.craft = 'all'; sync(); }
      if (e.target.closest('[data-done]')) sheet.close();
    });
  }

  function openSort() {
    const sheet = openSheet({
      title: 'Sort projects',
      body: `<div class="option-list" role="radiogroup" aria-label="Sort">${SORTS.map(([k, label]) => `
        <button type="button" class="option ${view.sort === k ? 'is-on' : ''}" role="radio" aria-checked="${view.sort === k}" data-sortby="${k}">
          <span class="option__text"><strong>${esc(label)}</strong></span>
          <span class="option__tick" aria-hidden="true">${icons.check}</span>
        </button>`).join('')}</div>`,
    });
    sheet.body.addEventListener('click', (e) => {
      const o = e.target.closest('[data-sortby]');
      if (!o) return;
      view.sort = o.dataset.sortby; saveView(view); paint(); sheet.close();
    });
  }

  const onData = () => refresh();
  window.addEventListener('ld:data-changed', onData);
  window.addEventListener('ld:files-changed', onData);

  await refresh();
  if (await shouldShowTour()) openTour();

  return () => {
    window.removeEventListener('ld:data-changed', onData);
    window.removeEventListener('ld:files-changed', onData);
    document.querySelector('.tour')?.remove();
  };
}
