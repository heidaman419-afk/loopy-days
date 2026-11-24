// Project page (#/project/<id>): status, start date, pattern + stats, photos, yarn,
// tools, notes, charts, and the big "Start / Keep knitting" button. Full screen.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc, el, fmtLong } from '../ui/dom.js';
import { openSheet, toast } from '../ui/overlay.js';
import {
  getProject, mainCounterOf, statusOf, statusLabel, STATUSES, craftOf, craftLabel, niceDate, localDate, progressOf,
} from '../data/projects.js';
import { listPhotos, addPhoto, thumbUrl, fullUrl, deletePhoto } from '../data/photos.js';
import { timeWorked, loadTimerSettings } from '../data/timer.js';
import { pickPhoto, withPhotoBusy, viewPhoto } from '../ui/photo-picker.js';

export const fullscreen = true;

/** Plain-text summary for sharing. */
export function shareText(p, main, ms) {
  const lines = [`${p.name} (${craftLabel(craftOf(p))})`, `Status: ${statusLabel(statusOf(p))}`];
  if (main) lines.push(main.target ? `Rows: ${main.value} of ${main.target}` : `Rows: ${main.value}`);
  lines.push(`Time worked: ${ms ? fmtLong(ms) : 'not started yet'}`);
  if (p.start_date) lines.push(`Started: ${niceDate(p.start_date)}`);
  lines.push('Kept with Loopy Days');
  return lines.join('\n');
}

export async function mount(root, params) {
  let project = await getProject(params[0]);
  if (!project) { location.hash = '#/projects'; return; }
  if (project.draft) { location.hash = `#/project-new/${project.id}`; return; }

  let main = null;
  let photos = [];
  let notes = [];
  let worked = 0;
  let days = 0;
  let settings = await loadTimerSettings();

  root.innerHTML = `
    <header class="wave-head project-head">
      <div class="wave-head__bar">
        <div class="wave-head__side">
          <a class="icon-btn" href="#/projects" aria-label="Back to projects">${icons.back}</a>
        </div>
        <div></div>
        <div class="wave-head__side wave-head__side--right project-head__right">
          <button type="button" class="icon-btn" data-share aria-label="Share this project">${icons.share}</button>
          <a class="btn btn--text btn--small project-head__edit" href="#/project-edit/${project.id}">Edit</a>
        </div>
      </div>
      <h1 class="project-head__name" data-name></h1>
      <div class="project-head__chips">
        <button type="button" class="status-pill" data-status-btn></button>
        <label class="date-chip">
          ${icons.calendar}<span data-date-text></span>
          <input type="date" data-date aria-label="Start date">
        </label>
      </div>
      <svg class="wave-head__wave" viewBox="0 0 390 34" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0H390V16C352 26 318 30 268 22 212 13 170 4 118 10 70 15 34 30 0 22Z"/>
      </svg>
    </header>

    <main class="project-page">
      <div class="duo">
        <section class="duo__pattern">
          <h2 class="sec-title">${icons.pattern}<span>Pattern</span></h2>
          <div class="dash-box dash-box--fill" role="note">
            ${icons.patterns}<strong>Add a pattern</strong><span>Coming soon</span>
          </div>
        </section>
        <section class="duo__stats">
          <h2 class="sec-title">${icons.stats}<span>Stats</span></h2>
          <div class="stats" data-stats tabindex="0" aria-label="Project stats, swipe for more"></div>
          <div class="stats__dots" aria-hidden="true"><span class="is-on"></span><span></span><span></span></div>
        </section>
      </div>

      <section class="psec">
        <h2 class="sec-title">${icons.image}<span>Photos</span></h2>
        <div data-photos></div>
      </section>

      <section class="psec">
        <h2 class="sec-title">${icons.yarn}<span>Yarn</span></h2>
        <div class="dash-box dash-box--soft" role="note">${icons.stash}<strong>Yarn from your stash</strong><span>Arrives with the Stash tab</span></div>
      </section>

      <section class="psec">
        <h2 class="sec-title">${icons.tools}<span>Tools</span></h2>
        <div class="dash-box dash-box--soft" role="note">${icons.tools}<strong>Needles and hooks</strong><span>Arrive with the Stash tab</span></div>
      </section>

      <section class="psec">
        <h2 class="sec-title">${icons.note}<span>Notes</span></h2>
        <button type="button" class="notes-box" data-notes></button>
        <ul class="row-notes" data-row-notes></ul>
      </section>

      <section class="psec">
        <h2 class="sec-title">${icons.grid}<span>Charts</span></h2>
        <div class="dash-box dash-box--soft" role="note">${icons.grid}<strong>No charts yet</strong><span>Charts arrive with Patterns</span></div>
      </section>
    </main>

    <footer class="knit-bar">
      <a class="knit-bar__go" href="#/counter/${project.id}" data-go>
        <span class="knit-bar__label">${icons.play}<span data-go-label>Start knitting</span></span>
        <span class="knit-bar__sub" data-go-sub></span>
      </a>
      <a class="knit-bar__quick" href="#/counter">Quick counter</a>
    </footer>`;

  const $ = (s) => root.querySelector(s);

  /* ---------- data ---------- */

  async function load() {
    const fresh = await getProject(project.id);
    if (!fresh) { location.hash = '#/projects'; return false; }
    project = fresh;
    main = await mainCounterOf(project.id);
    photos = await listPhotos(project.id);
    notes = main ? (await db.byIndex('row_notes', 'counter_id', main.id)).sort((a, b) => a.row - b.row) : [];
    settings = await loadTimerSettings();
    worked = await timeWorked(project.id, settings);
    const sessions = await db.byIndex('sessions', 'project_id', project.id);
    days = new Set(sessions.filter((s) => (s.active_ms || 0) > 0 || s.rows > 0 || s.status === 'running')
      .map((s) => localDate(new Date(s.started_at)))).size;
    return true;
  }

  /* ---------- painting ---------- */

  function paintHead() {
    $('[data-name]').textContent = project.name || 'Untitled project';
    const st = statusOf(project);
    const btn = $('[data-status-btn]');
    btn.dataset.status = st;
    btn.innerHTML = `<span class="status-dot"></span><span>${statusLabel(st)}</span>${icons.chevronDown}`;
    btn.setAttribute('aria-label', `Status: ${statusLabel(st)}. Change status`);
    $('[data-date-text]').textContent = project.start_date ? `Started ${niceDate(project.start_date)}` : 'Add start date';
    $('[data-date]').value = project.start_date || '';
  }

  function paintStats() {
    const rows = main ? main.value : 0;
    const pct = progressOf(project, main);
    $('[data-stats]').innerHTML = `
      <div class="stat"><strong>${worked ? esc(shortTime(worked)) : '0m'}</strong><span>Time worked</span></div>
      <div class="stat"><strong>${rows}</strong><span>${main && main.target ? `of ${main.target} rows · ${pct}%` : 'Rows done'}</span></div>
      <div class="stat"><strong>${days}</strong><span>${days === 1 ? 'Day worked' : 'Days worked'}</span></div>`;
  }

  async function paintPhotos() {
    const box = $('[data-photos]');
    if (!photos.length) {
      box.innerHTML = `<button type="button" class="dash-box dash-box--big" data-add-photo>
        ${icons.camera}<strong>Add your first photo</strong><span>Tap to keep a picture of how it’s coming along</span></button>`;
      return;
    }
    box.innerHTML = `<div class="photo-row">
      <button type="button" class="photo-add" data-add-photo aria-label="Add a photo">${icons.plus}<span>Add</span></button>
      ${photos.map((ph) => `
        <button type="button" class="photo-thumb ${project.cover_photo_id === ph.id ? 'is-cover' : ''}" data-photo="${ph.id}" aria-label="Open photo${project.cover_photo_id === ph.id ? ' (cover)' : ''}">
          <img alt="" hidden data-thumb="${ph.id}"><span class="photo-thumb__wait">${icons.cloud}</span>
          ${project.cover_photo_id === ph.id ? `<span class="photo-thumb__star">${icons.star}</span>` : ''}
        </button>`).join('')}
    </div>`;
    for (const img of box.querySelectorAll('[data-thumb]')) {
      const u = await thumbUrl(img.dataset.thumb);
      if (u && img.isConnected) { img.src = u; img.hidden = false; img.nextElementSibling.hidden = true; }
    }
  }

  function paintNotes() {
    const b = $('[data-notes]');
    b.classList.toggle('has-text', !!project.notes);
    b.innerHTML = project.notes
      ? `<span class="notes-box__text">${esc(project.notes)}</span><span class="notes-box__edit">${icons.pencil}Edit</span>`
      : `${icons.pencil}<span>Tap to add notes. Row reminders from the counter show up below.</span>`;
    $('[data-row-notes]').innerHTML = notes.map((n) => `
      <li class="${n.done ? 'is-done' : ''}"><span class="note-item__row">Row ${n.row}</span><span>${esc(n.text)}</span></li>`).join('');
  }

  function paintGo() {
    const started = (main && main.value > 0) || worked > 0;
    $('[data-go-label]').textContent = started ? 'Keep knitting' : 'Start knitting';
    const rowText = main ? (main.target ? `Row ${main.value} of ${main.target}` : `Row ${main.value}`) : 'Row 0';
    $('[data-go-sub]').textContent = `${project.name || 'Untitled project'} · ${rowText}`;
  }

  function paintAll() { paintHead(); paintStats(); paintPhotos(); paintNotes(); paintGo(); }

  async function saveProject() {
    await db.put('projects', project);
    paintHead(); paintStats(); paintGo();
  }

  /* ---------- events ---------- */

  $('[data-status-btn]').addEventListener('click', () => {
    const sheet = openSheet({
      title: 'Project status',
      body: `<div class="option-list" role="radiogroup" aria-label="Status">${STATUSES.map(([k, label]) => `
        <button type="button" class="option ${statusOf(project) === k ? 'is-on' : ''}" role="radio" aria-checked="${statusOf(project) === k}" data-set-status="${k}">
          <span class="status-dot" data-status="${k}"></span>
          <span class="option__text"><strong>${esc(label)}</strong></span>
          <span class="option__tick" aria-hidden="true">${icons.check}</span>
        </button>`).join('')}</div>`,
    });
    sheet.body.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-set-status]');
      if (!o) return;
      project.status = o.dataset.setStatus;
      if (project.status === 'finished' && !project.finished_date) project.finished_date = localDate();
      if (project.status !== 'finished') project.finished_date = null;
      if (project.status === 'in_progress' && !project.start_date) project.start_date = localDate();
      sheet.close();
      await saveProject();
      if (project.status === 'finished') toast('Finished! Lovely work.');
    });
  });

  $('[data-date]').addEventListener('change', async (e) => {
    project.start_date = e.target.value || null;
    await saveProject();
  });

  $('[data-share]').addEventListener('click', () => {
    const text = shareText(project, main, worked); // built before the call: keeps the tap gesture
    if (navigator.share) {
      navigator.share({ title: project.name, text }).catch((err) => {
        if (err && err.name !== 'AbortError') copy(text);
      });
    } else copy(text);
  });
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied, ready to paste'), () => toast('Couldn’t copy on this device'));
    } else toast('Sharing isn’t available here');
  }

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add-photo]')) {
      pickPhoto(async (file) => {
        const ph = await withPhotoBusy(() => addPhoto(project.id, file));
        if (!ph) return;
        if (!project.cover_photo_id) { project.cover_photo_id = ph.id; await db.put('projects', project); }
        await load(); paintPhotos();
      });
      return;
    }
    const t = e.target.closest('[data-photo]');
    if (t) {
      const ph = photos.find((x) => x.id === t.dataset.photo);
      if (!ph) return;
      viewPhoto({
        getUrl: () => fullUrl(ph.id),
        isCover: project.cover_photo_id === ph.id,
        onCover: async () => { project.cover_photo_id = ph.id; await db.put('projects', project); await load(); paintPhotos(); },
        onDelete: async () => { await deletePhoto(ph, project); await load(); paintPhotos(); },
      });
      return;
    }
    if (e.target.closest('[data-notes]')) openNotes();
  });

  function openNotes() {
    const body = el(`
      <form class="notes-form">
        <textarea class="input input--area input--tall" name="notes" maxlength="4000"
          placeholder="Needle size, changes you made, who it’s for…">${esc(project.notes || '')}</textarea>
        <button type="submit" class="btn btn--butter btn--block">Save notes</button>
      </form>`);
    const sheet = openSheet({ title: 'Project notes', body, className: 'sheet--tall' });
    const f = body;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      project.notes = f.notes.value.trim();
      sheet.close();
      await db.put('projects', project);
      paintNotes();
      toast('Notes saved');
    });
    requestAnimationFrame(() => f.notes.focus());
  }

  // Swipeable stats: keep the dots in step.
  const statsEl = $('[data-stats]');
  statsEl.addEventListener('scroll', () => {
    const i = Math.round(statsEl.scrollLeft / Math.max(1, statsEl.clientWidth));
    root.querySelectorAll('.stats__dots span').forEach((d, j) => d.classList.toggle('is-on', j === i));
  }, { passive: true });

  const onData = async () => { if (await load()) paintAll(); };
  window.addEventListener('ld:data-changed', onData);
  window.addEventListener('ld:files-changed', onData);

  if (await load()) paintAll();

  return () => {
    window.removeEventListener('ld:data-changed', onData);
    window.removeEventListener('ld:files-changed', onData);
    document.querySelector('.viewer')?.remove();
  };
}

function shortTime(ms) {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
