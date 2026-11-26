// Follow a guide while knitting (#/guide/<projectId>).
// One cursor (guide_progress.cursor) is the truth. Each Next/back moves it, paints at once,
// then saves: the cursor, the project's main counter (rows done overall), the session,
// last worked and per-step time. Same tap rules as the counter: pointerdown, paint, save.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc, el, onTap, fmtDuration, fmtLong, timeAgo } from '../ui/dom.js';
import { openSheet, openDialog, toast, confirmDialog } from '../ui/overlay.js';
import { getProject, markWorked, localDate } from '../data/projects.js';
import { ProjectCounters } from '../data/counters.js';
import { SessionTimer, loadTimerSettings } from '../data/timer.js';
import { getPattern, getGuide, guideId, progressFor } from '../data/patterns.js';
import { next, prev, clamp, rowsDone, totalRows, locate, flatten, progressPct, checksAt, measuredRows } from '../patterns/guide-math.js';
import { markup, explainAbbrs, KIND_LABEL } from '../patterns/ui.js';
import { REPEAT_SCOPE_SINCE } from '../patterns/parse-guide.js';
import { openTimerSettings } from './timer-settings.js';
import { openLock } from './lock.js';
import { pickPhoto, withPhotoBusy } from '../ui/photo-picker.js';
import { addPhoto } from '../data/photos.js';

export const fullscreen = true;

export async function mount(root, params) {
  const project = await getProject(params[0]);
  if (!project) { location.hash = '#/projects'; return; }
  const pattern = await getPattern(project.pattern_id);
  const guide = pattern ? await getGuide(guideId(pattern.id, project.size_id)) : null;
  if (!pattern || !guide) { location.hash = `#/counter/${project.id}`; return; }
  let tree = guide.tree;
  // Guides read before repeat checks had a scope get the safe display (no stored change).
  const scopedOf = (g) => (+(g && g.reader) || 0) >= REPEAT_SCOPE_SINCE;
  let scoped = scopedOf(guide);
  let settings = await loadTimerSettings();
  let model = await ProjectCounters.load(project.id);
  const timer = await SessionTimer.load(project.id, settings);
  let progress = await progressFor(project, guide);
  let lock = null;
  let lastTouch = 0;
  let inFlight = 0;
  let markMs = timer.activeMs();
  const TOTAL = () => totalRows(tree);
  // Per step-and-pass memory for "work until it measures…" steps: rows worked there, tallies.
  const keyOf = (c) => `${c.block_id}#${c.pass || 0}`;
  const measureSum = () => measuredRows(tree, progress.measure);   // only steps in this guide count
  const overall = () => rowsDone(tree, progress.cursor) + measureSum();      // what the project counter shows
  const isRoundBlock = (b) => /\b(?:rnds?|rounds?|in the round)\b/i.test(`${b.text || ''} ${b.note || ''}`) || /round/i.test(b.title || '');
  const hasMeasure = () => flatten(tree).some((f) => f.block.kind === 'measure');
  /** Keep project.guide_pct (rings on Home / Projects) in step; returns the entry to save if it moved. */
  const pctEntry = () => {
    const pct = progressPct(tree, progress.cursor);
    if (project.guide_pct === pct) return null;
    project.guide_pct = pct;
    return ['projects', project];
  };

  // The project's goal follows the guide's rows (no fixed goal when lengths are measured).
  const wantTarget = hasMeasure() ? null : (TOTAL() || null);
  if (model.main.target !== wantTarget) { model.main.target = wantTarget; save([['counters', model.main]]); }

  root.innerHTML = `
    <header class="fg-head">
      <a class="icon-btn" href="#/project/${project.id}" aria-label="Back to the project">${icons.back}</a>
      <h1 class="fg-head__title">${esc(project.name)}</h1>
      <button type="button" class="icon-btn" data-menu aria-label="More">${icons.more}</button>
    </header>
    <main class="fg">
      <div class="fg-progress"><div class="bar"><span class="bar__fill" data-bar></span></div>
        <div class="fg-progress__row"><span data-pct>0%</span><button type="button" class="timer-pill" data-timer></button></div></div>
      <p class="fg-where" data-where></p>
      <h2 class="fg-title" data-title></h2>
      <div class="fg-tiles" data-tiles></div>
      <div class="fg-card" data-card></div>
      <details class="fg-overview" data-overview><summary>${icons.list}<span>Repeat overview</span><span class="count-chip" data-steps></span>${icons.chevronDown}</summary><ol data-list></ol></details>
      <p class="info-note fg-note" data-note hidden></p>
      <div class="fg-tools">
        <button type="button" data-tool="note">${icons.note}<span>Note</span></button>
        <button type="button" data-tool="photo">${icons.camera}<span>Photo</span></button>
        <button type="button" data-tool="pdf" ${pattern.pdf_file_id ? '' : 'disabled'}>${icons.file}<span>PDF</span></button>
      </div>
    </main>
    <footer class="fg-bar">
      <div class="fg-bar__row">
        <button type="button" class="fg-round" data-prev aria-label="One step back">${icons.minus}</button>
        <button type="button" class="fg-next" data-next>${icons.play}<span data-next-label>Next row</span></button>
        <button type="button" class="fg-round" data-jump aria-label="Jump to a row">${icons.plus}</button>
      </div>
      <p class="fg-last" data-last></p>
    </footer>`;
  const $ = (s) => root.querySelector(s);
  explainAbbrs(root, () => pattern.glossary);

  function save(entries) {
    if (!entries || !entries.length) return;
    inFlight++;
    db.putMany(entries).catch((e) => { console.error(e); toast('Couldn’t save. Is the phone’s storage full?'); }).finally(() => { inFlight--; });
  }

  /* ---------- painting ---------- */

  function paint() {
    const c = progress.cursor;
    const L = locate(tree, c);
    const total = TOTAL();
    const done = rowsDone(tree, c);
    const pct = progressPct(tree, c);
    $('[data-bar]').style.width = `${pct}%`;
    $('[data-pct]').textContent = total
      ? `${pct}% · row ${Math.min(done + (c.done ? 0 : 1), total)} of ${total}${measureSum() ? ` (+${measureSum()} measured)` : ''}`
      : `${pct}%`;
    if (!L) { $('[data-title]').textContent = 'This guide has no steps yet'; return; }
    const b = L.block;
    const passLabel = L.passes > 1 ? ` · ${L.piece.name.replace(/s$/i, '')} ${L.pass + 1} of ${L.passes}` : '';
    $('[data-where]').textContent = `${L.piece.name}${passLabel}${L.section.name !== L.piece.name ? ` · ${L.section.name}` : ''}`;
    $('[data-title]').textContent = b.title || KIND_LABEL[b.kind];
    const isRows = b.kind === 'rows' || b.kind === 'repeat';
    const r = L.rowObj;
    $('[data-tiles]').innerHTML = isRows ? `
      <div class="fg-tile fg-tile--row"><span class="fg-tile__lab">${icons.list}Row ${r && r.side ? `<span class="side">${r.side}</span>` : ''}</span>
        <strong>${L.rowInBlock}/${L.rowsInStep}</strong></div>
      ${L.repeat ? `<div class="fg-tile fg-tile--rep"><span class="fg-tile__lab">${icons.repeat}<span class="fg-tile__name">${esc(b.title || 'Repeat')}</span></span>
        <strong>${L.repeat.n}/${L.repeat.of}</strong></div>` : ''}` : '';
    $('[data-tiles]').classList.toggle('is-single', isRows && !L.repeat);
    const card = $('[data-card]');
    if (c.done) {
      card.innerHTML = `<p class="fg-text">${icons.sparkle} You’ve reached the end of the guide.</p>`;
    } else if (isRows) {
      card.innerHTML = `<p class="fg-text">${markup(r ? r.text : '', pattern.glossary)}</p>${r && r.same_as ? `<span class="fg-hint">Same as row ${r.same_as}</span>` : ''}
        <span class="fg-hint">Row ${L.patternRow} of the pattern</span>`;
    } else if (b.kind === 'cast_on') {
      const target = b.stitches || 0;
      card.innerHTML = `
        ${b.text ? `<p class="fg-text fg-text--small">${markup(b.text, pattern.glossary)}</p>` : ''}
        <div class="cast">
          <p class="cast__num"><strong data-cast>${c.cast || 0}</strong>${target ? ` / ${target}` : ''}</p>
          <p class="cast__lab">cast on${b.method ? ` · ${esc(b.method)}` : ''}</p>
          <div class="cast__btns">${[1, 5, 10].map((n) => `<button type="button" class="cast__btn cast__btn--plus" data-cast-step="${n}">+${n}</button>`).join('')}</div>
          <div class="cast__btns">${[1, 5, 10].map((n) => `<button type="button" class="cast__btn" data-cast-step="-${n}">−${n}</button>`).join('')}</div>
          <button type="button" class="btn btn--text btn--small" data-cast-reset>Reset</button>
        </div>`;
    } else if (b.kind === 'measure') {
      const k = keyOf(c);
      const n = (progress.measure || {})[k] || 0;
      const tally = (progress.tally || {})[k] || 0;
      card.innerHTML = `
        <p class="fg-text fg-text--small">${markup(b.text || '', pattern.glossary)}</p>
        ${b.target ? `<span class="measure-target">${icons.ruler}<span>Until it measures <strong>${esc(b.target)}</strong></span></span>` : ''}
        <div class="cast">
          <p class="cast__num"><strong data-mrows>${n}</strong></p>
          <p class="cast__lab">${isRoundBlock(b) ? 'rounds' : 'rows'} so far</p>
          <div class="cast__btns">
            <button type="button" class="cast__btn" data-mstep="-1" aria-label="One less">−1</button>
            <button type="button" class="cast__btn cast__btn--plus cast__btn--wide" data-mstep="1" aria-label="One more">+1</button>
          </div>
        </div>
        ${b.tally_target ? `<div class="tally"><span>${esc(b.tally_label || 'Done')}: <strong data-tally>${tally}</strong> / ${b.tally_target}</span>
          <button type="button" class="btn btn--pink btn--small" data-tally-step="1">+1</button>
          <button type="button" class="btn btn--text btn--small" data-tally-step="-1">−1</button></div>` : ''}`;
    } else {
      card.innerHTML = `<p class="fg-text fg-text--small">${markup(b.text || '', pattern.glossary)}</p>`;
    }
    const ov = $('[data-overview]');
    ov.hidden = !isRows;
    if (isRows) {
      $('[data-steps]').textContent = `${(b.rows || []).length} ${(b.rows || []).length === 1 ? 'row' : 'rows'}`;
      ov.querySelector('summary span').textContent = b.kind === 'repeat' ? 'Repeat overview' : 'Rows in this step';
      $('[data-list]').innerHTML = (b.rows || []).map((x, i) => `<li class="${i === c.row ? 'is-now' : ''}"><strong>Row ${x.n}${x.side ? ` (${x.side})` : ''}</strong><span>${markup(x.text, pattern.glossary)}</span></li>`).join('');
    }
    const chk = checksAt(L, { scoped });
    const note = [b.note, chk.row && !c.done ? `Stitch check after this row: ${chk.row}` : '', chk.block ? `Stitch check: ${chk.block}` : ''].filter(Boolean).join(' · ');
    $('[data-note]').hidden = !note;
    if (note) $('[data-note]').innerHTML = `${icons.info}<span>${esc(note)}</span>`;
    $('[data-next-label]').textContent = c.done ? 'Finished' : isRows ? (L.isLast && L.rowInBlock === L.rowsInStep && (!L.repeat || L.repeat.n === L.repeat.of) ? 'Last row done' : 'Next row') : 'Done, next';
    $('[data-next]').disabled = !!c.done;
    $('[data-prev]').disabled = !c.done && flatten(tree)[0] && c.block_id === flatten(tree)[0].block.id && !c.row && !c.rep;
    paintTimer(); paintLast(); paintLock();
  }

  function paintTimer() {
    const t = fmtDuration(timer.activeMs());
    const pill = $('[data-timer]');
    if (!timer.s) { pill.className = 'timer-pill'; pill.innerHTML = `${icons.play}<span>Start timer</span>`; }
    else if (timer.running) { pill.className = 'timer-pill is-running'; pill.innerHTML = `${icons.pause}<span>${t}</span>`; }
    else { pill.className = 'timer-pill is-paused'; pill.innerHTML = `${icons.play}<span>Carry on · ${t}</span>`; }
    if (lock) lock.setTimer(timer.s ? t : '');
  }
  function paintLast() {
    const at = model.main.last_tapped_at;
    $('[data-last]').textContent = at ? `Last tapped ${timeAgo(at)}` : 'Tap Next row after each row you finish';
  }
  function paintLock() {
    if (!lock) return;
    const L = locate(tree, progress.cursor);
    const total = TOTAL(); const done = rowsDone(tree, progress.cursor);
    const measured = L && L.block.kind === 'measure' ? ((progress.measure || {})[keyOf(progress.cursor)] || 0) : null;
    lock.paint({
      label: L ? (L.block.title || '') : '',
      value: measured != null ? String(measured) : L && L.rowsInStep ? `${L.rowInBlock}/${L.rowsInStep}` : '✓',
      goalText: measured != null ? `Until ${L.block.target || 'it measures enough'}` : `${done} / ${total} rows`,
      goalPct: progressPct(tree, progress.cursor), timerText: '',
    });
    lock.note(L && L.rowObj ? L.rowObj.text : '');
  }

  /* ---------- moving ---------- */

  function addBlockTime() {
    const now = timer.activeMs();
    const id = progress.cursor.block_id;
    if (id && now > markMs) progress.block_ms = { ...(progress.block_ms || {}), [id]: ((progress.block_ms || {})[id] || 0) + (now - markMs) };
    markMs = now;
  }

  function step(dir) {
    lastTouch = Date.now();
    addBlockTime();
    const before = rowsDone(tree, progress.cursor);
    const res = dir > 0 ? next(tree, progress.cursor) : prev(tree, progress.cursor);
    progress.cursor = res.cursor;
    paint();                                                // 1. screen
    const after = rowsDone(tree, progress.cursor);
    const entries = [];
    const delta = after - before;
    if (delta) {
      const r = model.bump(model.main, delta);              // the counter shows rows done overall
      if (r) entries.push(...r.entries);
    }
    let s = null;
    if (delta) s = timer.noteTap(delta);
    else if (dir > 0) {                                     // a step without rows still means knitting
      if (!timer.s) timer.start(); else if (timer.paused) timer.resume();
      timer.s.last_activity = Date.now();
      s = timer.s;
    }
    if (s) entries.push(['sessions', s]);
    if (dir > 0 && markWorked(project)) entries.push(['projects', project]);
    if (res.finished) progress.completed_at = new Date().toISOString();
    else if (dir < 0) progress.completed_at = null;
    entries.push(['guide_progress', progress]);
    const pe = pctEntry();
    if (pe && !entries.some((x) => x[1] === project)) entries.push(pe);
    save(entries);                                          // 2. disk
    if (res.finished) finishedCard();
  }

  function finishedCard() {
    openDialog({
      title: 'You finished the guide!',
      body: `<p class="dialog__text">Every step of ${esc(pattern.name)} is done. Time to weave in and admire it.</p>`,
      actions: [
        { label: 'Mark project finished', kind: 'primary', onClick: () => {
          project.status = 'finished';
          project.finished_date = project.finished_date || localDate();
          save([['projects', project]]);
          toast('Project finished. Lovely work!');
        } },
        { label: 'Not yet', kind: 'text' },
      ],
    });
  }

  function castStep(n) {
    lastTouch = Date.now();
    progress.cursor = { ...progress.cursor, cast: Math.max(0, (progress.cursor.cast || 0) + n) };
    const el2 = $('[data-cast]');
    if (el2) el2.textContent = progress.cursor.cast;
    save([['guide_progress', progress]]);
  }

  /** Rows worked on a "until it measures…" step: shown here and counted on the project counter. */
  function measureStep(n) {
    lastTouch = Date.now();
    const k = keyOf(progress.cursor);
    const cur = (progress.measure || {})[k] || 0;
    const nv = Math.max(0, cur + n);
    if (nv === cur) return;
    progress.measure = { ...(progress.measure || {}), [k]: nv };
    const el2 = $('[data-mrows]');
    if (el2) el2.textContent = nv;                          // 1. screen
    const entries = [['guide_progress', progress]];
    const r = model.bump(model.main, nv - cur);
    if (r) entries.push(...r.entries);
    const s = timer.noteTap(nv - cur);
    if (s) entries.push(['sessions', s]);
    if (n > 0 && markWorked(project)) entries.push(['projects', project]);
    save(entries);                                          // 2. disk
    paintLast();
    $('[data-pct]').textContent = $('[data-pct]').textContent.replace(/ \(\+\d+ measured\)$/, '') + (measureSum() ? ` (+${measureSum()} measured)` : '');
    if (lock) paintLock();
  }

  function tallyStep(n) {
    lastTouch = Date.now();
    const k = keyOf(progress.cursor);
    const cur = (progress.tally || {})[k] || 0;
    const nv = Math.max(0, cur + n);
    progress.tally = { ...(progress.tally || {}), [k]: nv };
    const el2 = $('[data-tally]');
    if (el2) el2.textContent = nv;
    save([['guide_progress', progress]]);
  }

  function jumpSheet() {
    const flat = flatten(tree);
    const body = el(`<form class="jump"><p class="settings__p">Already further along? Pick the step, then the repeat and row you’re on.</p>
      <label class="field"><span class="field__label">Step</span><select class="input" name="block">${flat.map((f) => `<option value="${f.block.id}#${f.pass}" ${f.block.id === progress.cursor.block_id && f.pass === (progress.cursor.pass || 0) ? 'selected' : ''}>${esc(`${f.piece.name}${f.passes > 1 ? ` ${f.pass + 1}/${f.passes}` : ''} · ${f.block.title || KIND_LABEL[f.block.kind]}`)}</option>`).join('')}</select></label>
      <div class="pform__two">
        <label class="field"><span class="field__label">Repeat</span><input class="input" name="rep" inputmode="numeric" pattern="[0-9]*" value="${progress.cursor.rep + 1}"></label>
        <label class="field"><span class="field__label">Row in the step</span><input class="input" name="row" inputmode="numeric" pattern="[0-9]*" value="${progress.cursor.row + 1}"></label>
      </div>
      <button class="btn btn--butter btn--block" type="submit">Go there</button></form>`);
    const sheet = openSheet({ title: 'Jump to a row', body });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      lastTouch = Date.now();
      addBlockTime();
      const before = rowsDone(tree, progress.cursor);
      const [bId, bPass] = body.block.value.split('#');
      progress.cursor = clamp(tree, { block_id: bId, pass: +bPass || 0, rep: (parseInt(body.rep.value, 10) || 1) - 1, row: (parseInt(body.row.value, 10) || 1) - 1, cast: 0, done: false });
      progress.completed_at = null;
      const delta = rowsDone(tree, progress.cursor) - before;
      const entries = [['guide_progress', progress]];
      if (delta) { const r = model.bump(model.main, delta); if (r) entries.push(...r.entries); }
      save(entries);
      sheet.close();
      paint();
    });
  }

  function menu() {
    const sheet = openSheet({
      title: 'Guide',
      body: `<div class="menu-list">
        <button type="button" class="menu-item" data-m="lock">${icons.phoneLock}<span>Lock screen</span></button>
        <button type="button" class="menu-item" data-m="timer">${icons.clock}<span>Timer &amp; breaks</span></button>
        ${pattern.pdf_file_id ? `<button type="button" class="menu-item" data-m="pdf">${icons.file}<span>View PDF</span></button>` : ''}
        <button type="button" class="menu-item" data-m="edit">${icons.pencil}<span>Edit the guide</span></button>
        <button type="button" class="menu-item" data-m="counter">${icons.counter}<span>Plain row counter</span></button>
      </div>`,
    });
    sheet.body.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]');
      if (!m) return;
      sheet.close();
      const k = m.dataset.m;
      if (k === 'timer') openTimerSettings(settings, () => paintTimer());
      if (k === 'pdf') openPdf();
      if (k === 'edit') location.hash = `#/guide-edit/${guide.id}/${project.id}`;
      if (k === 'counter') location.hash = `#/counter/${project.id}`;
      if (k === 'lock') {
        // In lock mode a tap is "one more row": on a measured step it adds to that step's rows.
        lock = openLock({ onPlus: () => {
          if (progress.cursor.done) return;
          const L = locate(tree, progress.cursor);
          if (L && L.block.kind === 'measure') measureStep(1); else step(1);
        }, onExit: () => { lock = null; } });
        paintLock(); paintTimer();
      }
    });
  }

  function openPdf() {
    const L = locate(tree, progress.cursor);
    location.hash = `#/pdf/${pattern.id}${L && L.block.page ? `/${L.block.page}` : ''}`;
  }

  /* ---------- events ---------- */

  onTap($('[data-next]'), () => { if (!progress.cursor.done) step(1); });
  onTap($('[data-prev]'), () => step(-1));
  $('[data-jump]').addEventListener('click', jumpSheet);
  $('[data-menu]').addEventListener('click', menu);
  onTap($('[data-timer]'), () => {
    lastTouch = Date.now();
    const s = timer.toggle();
    paintTimer();
    const entries = [['sessions', s]];
    if (timer.running && markWorked(project)) entries.push(['projects', project]);
    save(entries);
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const b = e.target.closest('[data-cast-step]');
    if (b) castStep(+b.dataset.castStep);
    const m = e.target.closest('[data-mstep]');
    if (m) measureStep(+m.dataset.mstep);
    const t = e.target.closest('[data-tally-step]');
    if (t) tallyStep(+t.dataset.tallyStep);
  });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cast-step]') && e.detail === 0) castStep(+e.target.closest('[data-cast-step]').dataset.castStep);
    if (e.target.closest('[data-mstep]') && e.detail === 0) measureStep(+e.target.closest('[data-mstep]').dataset.mstep);
    if (e.target.closest('[data-tally-step]') && e.detail === 0) tallyStep(+e.target.closest('[data-tally-step]').dataset.tallyStep);
    if (e.target.closest('[data-cast-reset]')) { progress.cursor = { ...progress.cursor, cast: 0 }; save([['guide_progress', progress]]); paint(); }
    const tool = e.target.closest('[data-tool]');
    if (!tool) return;
    const k = tool.dataset.tool;
    if (k === 'pdf') openPdf();
    if (k === 'photo') pickPhoto(async (file) => { await withPhotoBusy(() => addPhoto(project.id, file)); });
    if (k === 'note') {
      const L = locate(tree, progress.cursor);
      const row = overall() + 1;
      const body = el(`<form class="notes-form"><p class="settings__p">A note for row ${row} (${esc(L ? L.block.title : '')}). It shows on the project page and pops up on the counter.</p>
        <textarea class="input input--area" name="t" maxlength="300" placeholder="e.g. switch to the smaller needles"></textarea>
        <button class="btn btn--butter btn--block" type="submit">Save note</button></form>`);
      const sheet = openSheet({ title: 'Row note', body });
      body.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const t = body.t.value.trim();
        if (t) { const n = model.addNote(row, t); save([['row_notes', n]]); toast('Note saved'); }
        sheet.close();
      });
    }
  });

  /* ---------- timer + leaving ---------- */

  const tick = () => {
    const ch = timer.checkIdle();
    if (ch) save([['sessions', ch]]);
    paintTimer(); paintLast();
  };
  const interval = setInterval(tick, 1000);
  const leave = () => {
    addBlockTime();
    const s = timer.onLeave();
    save([...(s ? [['sessions', s]] : []), ['guide_progress', progress]]);
  };
  const onVis = () => {
    if (document.visibilityState === 'hidden') leave();
    else if (timer.checkLongPause()) {
      save([['sessions', timer.s]]);
      openDialog({
        title: 'Your session is resting',
        body: `<p class="dialog__text">It’s been quiet for a while. Time on hold isn’t counted.</p>`,
        dismissable: false,
        actions: [
          { label: 'Keep going', kind: 'primary', onClick: () => { save([['sessions', timer.resume()]]); paintTimer(); } },
          { label: 'Finish session', kind: 'secondary', onClick: () => { const s = timer.end('long-pause'); save([['sessions', s]]); toast(`Session saved: ${fmtLong(s.active_ms)}`); paintTimer(); } },
        ],
      });
    }
  };
  document.addEventListener('visibilitychange', onVis);

  // Another device moved on: re-read when the knitter isn't mid-tap.
  let reloadTimer = null;
  const reload = async () => {
    if (Date.now() - lastTouch < 2000 || inFlight || document.querySelector('#overlay-root .scrim')) { reloadTimer = setTimeout(reload, 900); return; }
    const started = lastTouch;
    const [g2, m2, p2, s2] = await Promise.all([getGuide(guide.id), ProjectCounters.load(project.id), db.get('guide_progress', progress.id), loadTimerSettings()]);
    if (lastTouch !== started) { reloadTimer = setTimeout(reload, 900); return; }
    if (g2) { tree = g2.tree; scoped = scopedOf(g2); }
    model = m2;
    settings = Object.assign(settings, s2);
    const t2 = await SessionTimer.load(project.id, settings);
    timer.s = t2.s;
    if (p2 && !p2.deleted) progress = { ...p2, cursor: clamp(tree, p2.cursor) };
    else progress.cursor = clamp(tree, progress.cursor);
    const fresh = await getProject(project.id);
    if (fresh) Object.assign(project, fresh);
    paint();
  };
  const onData = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 300); };
  window.addEventListener('ld:data-changed', onData);

  paint();
  if (timer.checkLongPause()) onVis();

  return () => {
    clearInterval(interval);
    clearTimeout(reloadTimer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('ld:data-changed', onData);
    leave();
    if (lock) { lock.close(); lock = null; }
  };
}
