// Project page (#/project/<id>): status, start date, pattern + stats, photos, yarn,
// tools, notes, charts, and the big "Start / Keep knitting" button. Full screen.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc, el, fmtLong } from '../ui/dom.js';
import { openSheet, toast, confirmDialog } from '../ui/overlay.js';
import {
  getProject, mainCounterOf, statusOf, statusLabel, STATUSES, craftOf, craftLabel, niceDate, localDate, progressOf,
} from '../data/projects.js';
import { listPhotos, addPhoto, thumbUrl, fullUrl, deletePhoto } from '../data/photos.js';
import { timeWorked, loadTimerSettings } from '../data/timer.js';
import { pickPhoto, withPhotoBusy, viewPhoto } from '../ui/photo-picker.js';
import { getPattern, listPatterns, coverUrl, pdfBlob, progressFor, keptOffline, setKeepOffline } from '../data/patterns.js';
import { knitTarget, markup, explainAbbrs, KIND_LABEL, blockSummary, pieceLabel } from '../patterns/ui.js';
import { askSize } from '../patterns/start-project.js';
import { flatten, clamp, rowsDone, locate, blockProgress, piecePercent, measuredRows } from '../patterns/guide-math.js';

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
  let pattern = null;
  let guide = null;
  let progress = null;
  let charts = [];
  let knitHref = `#/counter/${project.id}`;

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
          <div data-pattern-card></div>
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
        <div data-charts></div>
      </section>

      <section class="psec" data-guide-sec hidden>
        <h2 class="sec-title sec-title--row">${icons.patterns}<span>Pattern guide</span><a class="icon-btn icon-btn--small" data-guide-edit aria-label="Edit the guide">${icons.pencil}</a></h2>
        <div data-guide></div>
      </section>

      <section class="psec">
        <div class="offline-card">
          <div class="settings__row">
            <span><strong>Keep files offline</strong>
              <span class="settings__p">Save this project’s pattern PDF and photos on this device, so they open without signal.</span></span>
            <label class="switch"><input type="checkbox" data-keep aria-label="Keep files offline"><span class="switch__track"><span class="switch__dot"></span></span></label>
          </div>
          <p class="settings__p" data-keep-state></p>
          <a class="mini-link" href="#/settings">Manage offline storage${icons.chevronRight}</a>
        </div>
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
    photos = (await listPhotos(project.id)).filter((ph) => ph.kind !== 'chart');
    notes = main ? (await db.byIndex('row_notes', 'counter_id', main.id)).sort((a, b) => a.row - b.row) : [];
    settings = await loadTimerSettings();
    worked = await timeWorked(project.id, settings);
    const sessions = await db.byIndex('sessions', 'project_id', project.id);
    days = new Set(sessions.filter((s) => (s.active_ms || 0) > 0 || s.rows > 0 || s.status === 'running')
      .map((s) => localDate(new Date(s.started_at)))).size;
    pattern = project.pattern_id ? await getPattern(project.pattern_id) : null;
    const kt = await knitTarget(project);
    knitHref = kt.href;
    guide = kt.guide;
    progress = guide ? await progressFor(project, guide) : null;
    charts = (await db.byIndex('photos', 'project_id', project.id)).filter((ph) => ph.kind === 'chart');
    return true;
  }

  /* ---------- pattern + guide ---------- */

  async function paintPattern() {
    const box = $('[data-pattern-card]');
    if (!pattern) {
      box.innerHTML = `<button type="button" class="dash-box dash-box--fill" data-pick-pattern>${icons.patterns}<strong>Add a pattern</strong><span>From your patterns, or a new one</span></button>`;
      return;
    }
    const size = (pattern.sizes || []).find((s) => s.id === project.size_id);
    box.innerHTML = `
      <div class="pat-link">
        <button type="button" class="pat-link__x" data-unlink aria-label="Take the pattern off this project">${icons.close}</button>
        <a class="pat-link__main" href="#/pattern/${pattern.id}">
          <span class="pat-link__img" data-pl-cover>${icons.patterns}</span>
          <span class="pat-link__text"><strong>${esc(pattern.name)}</strong>
            ${pattern.designer ? `<span>by ${esc(pattern.designer)}</span>` : ''}
            ${(pattern.sizes || []).length ? `<span>${size ? `Size ${esc(size.name)}` : 'No size picked'}</span>` : ''}</span>
          ${icons.chevronRight}
        </a>
        ${pattern.pdf_file_id ? `<a class="pat-link__pdf" href="#/pdf/${pattern.id}">${icons.expand}<span>View PDF</span></a>` : ''}
      </div>`;
    const u = await coverUrl(pattern);
    const img = box.querySelector('[data-pl-cover]');
    if (u && img) img.innerHTML = `<img src="${u}" alt="">`;
  }

  function paintGuide() {
    const sec = $('[data-guide-sec]');
    sec.hidden = !pattern;
    if (!pattern) return;
    const g = $('[data-guide]');
    const sizes = pattern.sizes || [];
    if (!guide) {
      const sizeKey = project.size_id || (sizes.length ? '' : 'one');
      g.innerHTML = `<a class="dash-box dash-box--small" href="#/guide-size/${pattern.id}${sizeKey ? `/${sizeKey}` : ''}/${project.id}">
        ${icons.list}<strong>${sizes.length && !project.size_id ? 'Pick your size and build the guide' : 'Build the step-by-step guide'}</strong>
        <span>Follow the pattern row by row while you knit.</span></a>`;
      $('[data-guide-edit]').hidden = true;
      return;
    }
    $('[data-guide-edit]').hidden = false;
    $('[data-guide-edit]').href = `#/guide-edit/${guide.id}/${project.id}`;
    const c = progress.cursor;
    const ms = progress.block_ms || {};
    g.innerHTML = guide.tree.pieces.map((piece) => `
      <details class="gpiece" open>
        <summary class="gpiece__head"><span class="gpiece__tri">${icons.chevronDown}</span><strong>${esc(pieceLabel(piece))}</strong>
          <span class="pct-pill">${piecePercent(guide.tree, c, piece)}%</span></summary>
        ${piece.sections.map((s) => `
          ${piece.sections.length > 1 || s.name !== piece.name ? `<p class="gsec-name">${esc(s.name)}</p>` : ''}
          ${s.blocks.map((b) => {
            const bp = blockProgress(guide.tree, c, b.id);
            const st = bp.status;
            return `<button type="button" class="gblock gblock--${st}" data-block="${b.id}">
              <span class="gblock__mark">${st === 'done' ? icons.check : ''}</span>
              <span class="gblock__text"><strong>${esc(b.title || KIND_LABEL[b.kind])}</strong>
                <span>${b.kind === 'measure' ? `Measure · ${esc(blockSummary(b))}` : bp.of ? `Row ${Math.min(bp.done + (st === 'current' ? 1 : 0), bp.of)} of ${bp.of}` : esc(blockSummary(b))}</span>
                ${ms[b.id] ? `<span class="gblock__time">Time worked: ${ms[b.id] < 60000 ? '<1m' : esc(shortTime(ms[b.id]))}</span>` : ''}</span>
              <span class="gblock__state">${st === 'done' ? 'Done' : st === 'current' ? 'In progress' : st === 'partial' ? `${bp.passesDone} of ${bp.passes} done` : 'Not started'}</span>
            </button>`;
          }).join('')}`).join('')}
      </details>`).join('');
  }

  function blockSheet(id) {
    const flat = flatten(guide.tree);
    // For a piece worked more than once, the pass the knitter is on (or the first one).
    const here = flat.find((x) => x.block.id === progress.cursor.block_id && x.pass === (progress.cursor.pass || 0));
    const f = flat.find((x) => x.block.id === id && here && x.piece === here.piece && x.pass === here.pass) || flat.find((x) => x.block.id === id);
    if (!f) return;
    const b = f.block;
    const sheet = openSheet({
      title: b.title || KIND_LABEL[b.kind],
      className: 'sheet--tall',
      body: `<div class="bprev">
        <p class="bprev__sub">${f.rows ? `Rows ${f.start}–${f.end} of the pattern` : esc(KIND_LABEL[b.kind])}${b.kind === 'repeat' ? ` · ${b.times} times` : ''}${f.passes > 1 ? ` · ${esc(f.piece.name)} ${f.pass + 1} of ${f.passes}` : ''} · preview</p>
        ${b.kind === 'measure' && b.target ? `<p class="measure-target">${icons.ruler}<span>Until it measures <strong>${esc(b.target)}</strong></span></p>` : ''}
        ${(b.rows || []).length ? `<ol class="bprev__rows">${b.rows.map((r) => `<li><strong>Row ${r.n}${r.side ? ` (${r.side})` : ''}</strong><span>${markup(r.text, pattern.glossary)}</span></li>`).join('')}</ol>`
          : `<p class="fg-text fg-text--small">${markup(b.text || '', pattern.glossary)}</p>`}
        ${b.check ? `<p class="info-note">${icons.info}<span>Stitch check: ${esc(b.check)}</span></p>` : ''}
        <div class="bprev__actions">
          <button type="button" class="btn btn--butter" data-go-block>${icons.play}<span>Knit from here</span></button>
          <button type="button" class="btn btn--secondary" data-reset-block>Reset progress</button>
        </div></div>`,
    });
    explainAbbrs(sheet.body, () => pattern.glossary);
    sheet.body.addEventListener('click', async (e) => {
      const go = e.target.closest('[data-go-block]');
      const reset = e.target.closest('[data-reset-block]');
      if (!go && !reset) return;
      if (reset && !(await confirmDialog({ title: 'Reset progress?', message: `Your place goes back to the start of “${b.title || KIND_LABEL[b.kind]}”.`, ok: 'Reset' }))) return;
      progress.cursor = clamp(guide.tree, { block_id: b.id, pass: f.pass, rep: 0, row: 0, cast: 0, done: false });
      progress.completed_at = null;
      const entries = [['guide_progress', progress]];
      if (main) {
        const measured = measuredRows(guide.tree, progress.measure);
        const want = rowsDone(guide.tree, progress.cursor) + measured;
        if (main.value !== want) { main.value = want; entries.push(['counters', main]); }
      }
      await db.putMany(entries);
      sheet.close();
      if (go) location.hash = `#/guide/${project.id}`;
      else { paintGuide(); paintStats(); paintGo(); }
    });
  }

  async function pickPattern() {
    const all = await listPatterns();
    const sheet = openSheet({
      title: 'Add a pattern',
      className: 'sheet--tall',
      body: `<div class="menu-list">
        <a class="menu-item" href="#/pattern-new">${icons.plusCircle}<span>Add a new pattern</span></a>
        ${all.map((p) => `<button type="button" class="menu-item" data-pp="${p.id}">${icons.patterns}<span><strong>${esc(p.name)}</strong>${p.designer ? ` · ${esc(p.designer)}` : ''}</span></button>`).join('') || '<p class="list-box__empty">No patterns yet.</p>'}
      </div>`,
    });
    sheet.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pp]');
      if (!b) return;
      const p = all.find((x) => x.id === b.dataset.pp);
      sheet.close();
      const sizeId = await askSize(p);
      if (sizeId === null) return;
      project.pattern_id = p.id;
      project.size_id = sizeId || null;
      await db.put('projects', project);
      toast('Pattern added to the project');
      if (await load()) paintAll();
    });
  }

  async function paintCharts() {
    const box = $('[data-charts]');
    box.innerHTML = `${charts.length ? `<div class="photo-row">${charts.map((c) => `
      <button type="button" class="photo-thumb" data-chart="${c.id}" aria-label="Open chart"><img alt="" hidden data-thumb="${c.id}"><span class="photo-thumb__wait">${icons.grid}</span></button>`).join('')}</div>` : ''}
      <button type="button" class="dash-box ${charts.length ? 'dash-box--small' : 'dash-box--soft'}" data-add-chart>${icons.grid}<strong>Attach a chart image</strong>
        <span>A photo, or a page of the pattern PDF. A paint-your-own chart editor comes later.</span></button>`;
    for (const img of box.querySelectorAll('[data-thumb]')) {
      const u = await thumbUrl(img.dataset.thumb);
      if (u && img.isConnected) { img.src = u; img.hidden = false; img.nextElementSibling.hidden = true; }
    }
  }

  async function addChart() {
    const body = el(`<div class="cover-sheet">
      ${pattern && pattern.pdf_file_id ? '<p class="settings__p">Use a page of the pattern PDF:</p><div class="page-thumbs" data-thumbs><p class="list-box__empty">Drawing the pages…</p></div>' : ''}
      <button type="button" class="btn btn--secondary btn--block" data-photo>${icons.camera}<span>Use a photo</span></button></div>`);
    const sheet = openSheet({ title: 'Attach a chart', body, className: 'sheet--tall' });
    const done = async (fileOrBlob) => {
      const ph = await withPhotoBusy(() => addPhoto(project.id, fileOrBlob));
      if (ph) { ph.kind = 'chart'; await db.put('photos', ph); }
      if (await load()) paintAll();
    };
    body.querySelector('[data-photo]').addEventListener('click', () => { sheet.close(); pickPhoto(done, { title: 'Chart photo' }); });
    if (!(pattern && pattern.pdf_file_id)) return;
    const blob = await pdfBlob(pattern);
    const box = body.querySelector('[data-thumbs]');
    if (!blob) { box.innerHTML = '<p class="list-box__empty">The PDF isn’t on this device yet.</p>'; return; }
    const { openPdf, renderPage, pageToJpeg, closePdf } = await import('../patterns/pdf.js');
    const doc = await openPdf(blob);
    box.innerHTML = '';
    for (let n = 1; n <= doc.numPages && box.isConnected; n++) {
      const b = el(`<button type="button" class="page-thumb" data-page="${n}"><span>Page ${n}</span></button>`);
      box.appendChild(b);
      b.prepend(await renderPage(doc, n, 96, undefined, 400000));
    }
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      const jpg = await pageToJpeg(doc, +b.dataset.page, 1400, 0.85);
      sheet.close();
      closePdf(doc);
      await done(new File([jpg], 'chart.jpg', { type: 'image/jpeg' }));
    });
  }

  function paintKeep() {
    const on = keptOffline().has(project.id);
    $('[data-keep]').checked = on;
    $('[data-keep-state]').textContent = on ? 'Files are kept on this device and fetched at the next sync.' : 'Files open from your online space when you need them.';
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
    const go = $('[data-go]');
    go.href = knitHref;
    if (guide && progress) {
      const L = locate(guide.tree, progress.cursor);
      $('[data-go-label]').textContent = progress.cursor.done ? 'Guide finished' : 'Follow guide';
      $('[data-go-sub]').textContent = L ? `${L.piece.name} · ${L.block.title || KIND_LABEL[L.block.kind]}` : project.name;
      return;
    }
    const started = (main && main.value > 0) || worked > 0;
    $('[data-go-label]').textContent = started ? 'Keep knitting' : 'Start knitting';
    const rowText = main ? (main.target ? `Row ${main.value} of ${main.target}` : `Row ${main.value}`) : 'Row 0';
    $('[data-go-sub]').textContent = `${project.name || 'Untitled project'} · ${rowText}`;
  }

  function paintAll() {
    paintHead(); paintStats(); paintPhotos(); paintNotes(); paintGo();
    paintPattern(); paintGuide(); paintCharts(); paintKeep();
  }

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
    if (e.target.closest('[data-pick-pattern]')) pickPattern();
    if (e.target.closest('[data-unlink]')) {
      const ok = await confirmDialog({
        title: 'Take the pattern off?',
        message: `“${pattern.name}” stays in your patterns. This project just won’t follow it any more.`,
        ok: 'Take it off',
      });
      if (!ok) return;
      project.pattern_id = null;
      project.size_id = null;
      await db.put('projects', project);
      if (await load()) paintAll();
    }
    const blk = e.target.closest('[data-block]');
    if (blk && guide) blockSheet(blk.dataset.block);
    if (e.target.closest('[data-add-chart]')) addChart();
    const ch = e.target.closest('[data-chart]');
    if (ch) {
      const ph = charts.find((x) => x.id === ch.dataset.chart);
      if (ph) viewPhoto({
        getUrl: () => fullUrl(ph.id), isCover: false, noCover: true, onCover: async () => {},
        onDelete: async () => { await deletePhoto(ph, project); if (await load()) paintAll(); },
      });
    }
  });
  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-keep]')) return;
    setKeepOffline(project.id, e.target.checked);
    paintKeep();
    if (e.target.checked) {
      // Fetch the PDF right away if it isn't here yet (photos come with the next sync).
      if (pattern) pdfBlob(pattern).then(() => paintKeep());
      import('../sync/engine.js').then((m) => m.syncNow());
    }
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
