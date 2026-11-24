// The row counter screen (full screen, no tab bar).
// Speed rule: on a tap, change memory -> paint the number -> save. Nothing waits.

import * as db from '../db.js';
import { waveHeader, backButton } from '../ui/header.js';
import { icons } from '../ui/icons.js';
import { esc, el, onTap, fmtDuration, fmtLong, timeAgo } from '../ui/dom.js';
import { openDialog, confirmDialog, promptDialog, toast } from '../ui/overlay.js';
import { ensureQuickProject, getProject } from '../data/projects.js';
import { ProjectCounters } from '../data/counters.js';
import { SessionTimer, loadTimerSettings } from '../data/timer.js';
import { openTimerSettings } from './timer-settings.js';
import { goalDialog, notesSheet, extraCounterSheet } from './counter-sheets.js';
import { openLock } from './lock.js';

export const fullscreen = true;

export async function mount(root, params) {
  const project = params[0] ? await getProject(params[0]) : await ensureQuickProject();
  if (!project) { location.hash = '#/home'; return; }

  const [model, settings] = await Promise.all([
    ProjectCounters.load(project.id),
    loadTimerSettings(),
  ]);
  const timer = await SessionTimer.load(project.id, settings);
  if (timer.strays.length) {
    save(timer.strays.map((s) => { s.status = 'ended'; s.ended_at = s.ended_at || new Date(s.paused_at || s.seg_start).toISOString(); s.end_reason = 'stray'; return ['sessions', s]; }));
  }

  let lock = null;
  let breakCard = null;
  let breakEnds = 0;

  /* ---------------- markup ---------------- */

  root.innerHTML = `
    ${waveHeader({
      brand: false,
      left: backButton('Back to home'),
      right: `<button type="button" class="icon-btn icon-btn--card" data-act="settings" aria-label="Timer and break settings">${icons.gear}</button>`,
    })}
    <main class="counter-page">
      <h1 class="page-title">Row counter</h1>
      <p class="page-sub">${esc(project.name)}</p>

      <section class="count-card" aria-label="Main counter">
        <button type="button" class="count-card__label" data-act="rename" aria-label="Rename counter">
          <span data-label></span>${icons.pencil}
        </button>
        <p class="count-card__num" data-num aria-live="polite" aria-atomic="true">0</p>
        <div class="goal" data-goal hidden>
          <div class="goal__line"><span data-goal-text></span><span class="goal__pct" data-goal-pct></span></div>
          <div class="bar"><span class="bar__fill" data-goal-bar></span></div>
          <p class="goal__done" data-goal-done hidden>${icons.sparkle}<span>Goal reached. Lovely work!</span></p>
        </div>
        <div class="timer-row">
          <button type="button" class="timer-pill" data-act="timer"></button>
          <button type="button" class="timer-end" data-act="finish" hidden>Finish</button>
        </div>
        <p class="last-tap" data-last></p>
        <div class="count-btns">
          <button type="button" class="cbtn cbtn--minus" data-act="minus" aria-label="Take one away">−1</button>
          <button type="button" class="cbtn cbtn--plus" data-act="plus" aria-label="Add one">+1</button>
          <button type="button" class="cbtn cbtn--five" data-act="plus5" aria-label="Add five">+5</button>
        </div>
      </section>

      <button type="button" class="notes-strip" data-act="notes"></button>

      <section class="others" aria-label="Other counters">
        <h2 class="eyebrow">Other counters</h2>
        <div class="others__row" data-others></div>
      </section>
    </main>

    <div class="pop-area" data-pops aria-live="polite"></div>

    <nav class="action-bar" aria-label="Counter actions">
      <button type="button" data-act="reset">${icons.reset}<span>Reset</span></button>
      <button type="button" data-act="goal">${icons.flag}<span>Goal</span></button>
      <button type="button" data-act="undo">${icons.undo}<span>Undo</span></button>
      <button type="button" data-act="delete">${icons.trash}<span>Delete</span></button>
      <button type="button" data-act="lock">${icons.phoneLock}<span>Lock screen</span></button>
    </nav>`;

  const q = (s) => root.querySelector(s);
  const act = (name) => q(`[data-act="${name}"]`);
  const numEl = q('[data-num]');
  const pill = act('timer');
  const pops = q('[data-pops]');
  const othersRow = q('[data-others]');

  /* ---------------- saving ---------------- */

  function save(entries) {
    if (!entries || !entries.length) return;
    db.putMany(entries).catch((e) => {
      console.error(e);
      toast('Couldn’t save that change. Is your phone’s storage full?');
    });
  }

  /* ---------------- painting ---------------- */

  const main = () => model.main;

  function goalInfo() {
    const c = main();
    if (!c.target) return null;
    const pct = Math.min(100, Math.round((c.value / c.target) * 100));
    return { text: `${c.value} / ${c.target} ${c.name.toLowerCase()}`, pct, done: c.value >= c.target };
  }

  function paintNumber() {
    const v = main().value;
    numEl.textContent = v;
    numEl.classList.toggle('is-long', v >= 1000);
    if (lock) paintLock();
  }

  function paintGoal() {
    const g = goalInfo();
    const box = q('[data-goal]');
    box.hidden = !g;
    q('.count-card').classList.toggle('has-goal', !!g);
    if (g) {
      q('[data-goal-text]').textContent = g.text;
      q('[data-goal-pct]').textContent = `${g.pct}%`;
      q('[data-goal-bar]').style.width = `${g.pct}%`;
      q('[data-goal-done]').hidden = !g.done;
      box.classList.toggle('is-done', g.done);
    }
  }

  function timerText(now = Date.now()) {
    return fmtDuration(timer.activeMs(now));
  }

  function paintTimer() {
    const t = timerText();
    if (!timer.s) {
      pill.className = 'timer-pill';
      pill.innerHTML = `${icons.play}<span>Start timer</span>`;
      pill.setAttribute('aria-label', 'Start the session timer');
    } else if (timer.running) {
      pill.className = 'timer-pill is-running';
      pill.innerHTML = `${icons.pause}<span>${t}</span>`;
      pill.setAttribute('aria-label', `Pause the timer, ${t} so far`);
    } else {
      pill.className = 'timer-pill is-paused';
      pill.innerHTML = `${icons.play}<span>Carry on · ${t}</span>`;
      pill.setAttribute('aria-label', `Resume the timer, ${t} so far`);
    }
    act('finish').hidden = !timer.s;
    if (lock) lock.setTimer(timer.s ? (timer.running ? `${t}` : `Paused · ${t}`) : '');
  }

  function paintLastTap() {
    const at = main().last_tapped_at;
    q('[data-last]').textContent = at ? `Last tapped ${timeAgo(at)}` : 'Tap +1 to start counting';
  }

  function paintLabel() {
    q('[data-label]').textContent = main().name;
  }

  function paintUndo() {
    act('undo').disabled = !model.canUndo;
  }

  function paintNotesStrip() {
    const strip = act('notes');
    const open = model.notes.filter((n) => !n.done);
    if (!model.notes.length) {
      strip.innerHTML = `${icons.plusCircle}<span>Leave a note for a later row</span>`;
    } else {
      const next = model.nextNote();
      strip.innerHTML = `${icons.bell}<span><strong>${open.length} ${open.length === 1 ? 'note' : 'notes'}</strong>${next ? ` · next at row ${next.row}` : ''}</span><span class="notes-strip__open">See all</span>`;
    }
  }

  function renderOthers() {
    othersRow.innerHTML = `
      <button type="button" class="others__add" data-add>
        <span class="others__add-ring">${icons.plus}</span><span>Add</span>
      </button>
      ${model.extras.map((c) => `
        <div class="mini" data-id="${c.id}">
          <button type="button" class="mini__name" data-edit aria-label="Edit ${esc(c.name)}">
            <span>${esc(c.name)}</span>${icons.pencil}
          </button>
          <p class="mini__num" data-val>${c.value}</p>
          <div class="mini__btns">
            <button type="button" class="mini__btn" data-step="-1" aria-label="${esc(c.name)} minus one">${icons.minus}</button>
            <button type="button" class="mini__btn mini__btn--plus" data-step="1" aria-label="${esc(c.name)} plus one">${icons.plus}</button>
          </div>
          ${c.reset_with_main ? `<span class="mini__tag">${icons.reset}new each row</span>` : ''}
        </div>`).join('')}`;
  }

  function paintOtherValues() {
    for (const c of model.extras) {
      const v = othersRow.querySelector(`[data-id="${c.id}"] [data-val]`);
      if (v) v.textContent = c.value;
    }
  }

  function paintLock() {
    if (!lock) return;
    const g = goalInfo();
    lock.paint({
      label: main().name,
      value: main().value,
      goalText: g ? g.text : '',
      goalPct: g ? g.pct : 0,
      timerText: '',
    });
    paintTimer();
  }

  function paintAll() {
    paintLabel(); paintNumber(); paintGoal(); paintTimer(); paintLastTap();
    paintUndo(); paintNotesStrip(); paintOtherValues(); paintLock();
  }

  /* ---------------- pop-up cards (never block counting) ---------------- */

  function popCard({ icon, title, text, actions = [], tone = '', ms = 0, key = '' }) {
    if (key) pops.querySelector(`[data-key="${key}"]`)?.remove();
    const card = el(`
      <div class="pop ${tone}" ${key ? `data-key="${key}"` : ''} role="status">
        <span class="pop__icon">${icon}</span>
        <div class="pop__body"><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}
          <div class="pop__actions"></div></div>
        <button type="button" class="icon-btn icon-btn--small pop__x" aria-label="Close">${icons.close}</button>
      </div>`);
    const close = () => { card.classList.add('is-closing'); setTimeout(() => card.remove(), 160); };
    card.querySelector('.pop__x').addEventListener('click', () => { close(); actions.onClose && actions.onClose(); });
    for (const a of actions) {
      const b = el(`<button type="button" class="btn btn--small btn--${a.kind || 'secondary'}">${esc(a.label)}</button>`);
      b.addEventListener('click', () => { if (a.onClick() !== false) close(); });
      card.querySelector('.pop__actions').appendChild(b);
    }
    // Ignore taps on its buttons for a moment so a quick +1 tap can't hit "Done".
    card.classList.add('is-fresh');
    setTimeout(() => card.classList.remove('is-fresh'), 600);
    pops.appendChild(card);
    while (pops.children.length > 2) pops.firstElementChild.remove();
    if (ms) setTimeout(close, ms);
    card.close = close;
    return card;
  }

  function showReachedNotes(list) {
    for (const n of list) {
      popCard({
        key: `note-${n.id}`,
        icon: icons.bell,
        title: `Row ${n.row}`,
        text: n.text,
        tone: 'pop--note',
        actions: [{ label: 'Done', kind: 'pink', onClick: () => { n.done = true; save([['row_notes', n]]); paintNotesStrip(); } }],
      });
      if (lock) lock.note(`Row ${n.row}: ${n.text}`);
    }
  }

  function celebrateGoal() {
    popCard({
      key: 'goal', icon: icons.sparkle, tone: 'pop--goal',
      title: 'You reached your goal!',
      text: `${main().target} ${main().name.toLowerCase()} done. Time for a little stretch?`,
      ms: 7000,
    });
    if (lock) lock.note(`Goal reached: ${main().target} ${main().name.toLowerCase()}`);
  }

  /* ---------------- counting ---------------- */

  function changeMain(delta) {
    const c = main();
    const r = model.bump(c, delta);
    if (!r) { numEl.classList.remove('is-bump'); void numEl.offsetWidth; numEl.classList.add('is-bump'); return; }
    paintNumber();                                  // 1. number on screen
    const s = timer.noteTap(r.applied);             // 2. memory
    let goalHit = false;
    if (c.target && r.before < c.target && r.after >= c.target) { c.goal_reached_at = db.nowISO(); goalHit = true; }
    save(s ? [...r.entries, ['sessions', s]] : r.entries); // 3. disk
    // 4. everything else
    if (r.events.length > 1) paintOtherValues();
    paintGoal(); paintLastTap(); paintUndo(); paintTimer();
    const notes = model.notesReached(r.before, r.after);
    if (notes.length) { showReachedNotes(notes); paintNotesStrip(); }
    else if (r.applied > 0 && lock) lock.note('');
    if (goalHit) celebrateGoal();
  }

  function changeExtra(c, delta) {
    const r = model.bump(c, delta);
    if (!r) return;
    const v = othersRow.querySelector(`[data-id="${c.id}"] [data-val]`);
    if (v) v.textContent = c.value;
    const entries = r.entries;
    if (timer.running) { timer.s.last_activity = Date.now(); entries.push(['sessions', timer.s]); }
    save(entries);
    paintUndo();
  }

  function undo() {
    const u = model.undo();
    if (!u) return;
    paintNumber();
    const s = timer.s && u.at >= timer.s.started_at ? timer.noteUndo(u.mainDelta) : null;
    save(s ? [...u.entries, ['sessions', s]] : u.entries);
    paintGoal(); paintOtherValues(); paintUndo();
  }

  onTap(act('plus'), () => changeMain(+main().step || 1));
  onTap(act('minus'), () => changeMain(-(main().step || 1)));
  onTap(act('plus5'), () => changeMain(+main().big_step || 5));
  onTap(act('undo'), undo);
  onTap(act('timer'), () => {
    const s = timer.toggle();
    paintTimer();
    save([['sessions', s]]);
  });

  othersRow.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const c = model.counterById(b.closest('.mini').dataset.id);
    if (c) changeExtra(c, +b.dataset.step);
  });
  othersRow.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step && e.detail === 0) { // keyboard
      const c = model.counterById(step.closest('.mini').dataset.id);
      if (c) changeExtra(c, +step.dataset.step);
      return;
    }
    if (e.target.closest('[data-add]')) {
      const a = await extraCounterSheet(null);
      if (a && a.action === 'save') {
        const c = model.addExtra(a.name, a.resetWithMain);
        save([['counters', c]]);
        renderOthers();
        othersRow.scrollTo({ left: othersRow.scrollWidth, behavior: 'smooth' });
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const c = model.counterById(edit.closest('.mini').dataset.id);
      if (!c) return;
      const a = await extraCounterSheet(c);
      if (!a) return;
      if (a.action === 'save') {
        c.name = a.name; c.reset_with_main = a.resetWithMain;
        save([['counters', c]]); renderOthers();
      } else if (a.action === 'reset') {
        const r = model.reset(c);
        if (r) { save(r.entries); paintOtherValues(); paintUndo(); }
      } else if (a.action === 'remove') {
        model.removeExtra(c);
        save([['counters', c]]); renderOthers(); paintUndo();
      }
    }
  });

  /* ---------------- other actions ---------------- */

  act('back').addEventListener('click', () => { location.hash = '#/home'; });

  act('settings').addEventListener('click', () => openTimerSettings(settings, () => { paintTimer(); }));

  act('rename').addEventListener('click', async () => {
    const v = await promptDialog({
      title: 'Rename counter',
      label: 'What are you counting?',
      value: main().name,
      placeholder: 'Rows',
      maxlength: 24,
    });
    if (v) { main().name = v; save([['counters', main()]]); paintLabel(); paintGoal(); paintLock(); }
  });

  act('goal').addEventListener('click', async () => {
    const n = await goalDialog(main());
    if (n === null) return;
    const c = main();
    c.target = n || null;
    c.goal_reached_at = n && c.value >= n ? db.nowISO() : null;
    save([['counters', c]]);
    paintGoal(); paintLock();
    toast(n ? `Goal set: ${n} ${c.name.toLowerCase()}` : 'Goal cleared');
  });

  act('notes').addEventListener('click', () => notesSheet(model, save, paintNotesStrip));

  act('reset').addEventListener('click', async () => {
    if (main().value === 0) { toast('Already at 0'); return; }
    const ok = await confirmDialog({
      title: 'Start over from 0?',
      message: `Your ${main().name.toLowerCase()} go back to 0. You can still undo this.`,
      ok: 'Reset to 0', danger: true,
    });
    if (!ok) return;
    const r = model.reset(main());
    if (!r) return;
    paintNumber();
    save(r.entries); // a reset isn't "knitting", so session rows stay as they are
    paintGoal(); paintUndo();
  });

  act('delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this counter?',
      message: 'The count, goal, row notes and other counters for this project will be removed.',
      ok: 'Delete', danger: true,
    });
    if (!ok) return;
    const entries = model.deleteAllEntries();
    if (timer.s) entries.push(['sessions', timer.end('deleted')]);
    await db.putMany(entries).catch(console.error);
    toast('Counter deleted');
    location.hash = '#/home';
  });

  act('lock').addEventListener('click', () => {
    lock = openLock({
      onPlus: () => changeMain(+main().step || 1),
      onExit: () => { lock = null; },
    });
    paintLock();
  });

  /* ---------------- sessions: long pause, idle, breaks, leaving ---------------- */

  function longPauseCard() {
    const s = timer.s;
    const away = Date.now() - (s.paused_at || Date.now());
    const d = openDialog({
      dismissable: false,
      className: 'dialog--session',
      body: `
        <div class="session-card">
          <span class="session-card__badge">${icons.pause}</span>
          <h2 class="dialog__title">Your session is resting</h2>
          <p class="dialog__text">${esc(project.name)} has been on hold for ${fmtLong(away)}. Time on hold isn’t counted.</p>
          <p class="session-card__time">${fmtDuration(timer.activeMs())}</p>
          <p class="session-card__rows">${Math.max(0, s.rows)} ${Math.max(0, s.rows) === 1 ? 'row' : 'rows'} so far</p>
        </div>`,
      actions: [
        { html: `${icons.play}<span>Keep going</span>`, kind: 'primary', onClick: () => { save([['sessions', timer.resume()]]); paintTimer(); } },
        { label: 'Finish session', kind: 'secondary', onClick: () => finishSession('long-pause') },
      ],
    });
    return d;
  }

  function finishSession(reason = 'user') {
    if (!timer.s) return;
    const s = timer.end(reason);
    save([['sessions', s]]);
    paintTimer();
    const rows = Math.max(0, s.rows);
    toast(`Session saved: ${fmtLong(s.active_ms)}, ${rows} ${rows === 1 ? 'row' : 'rows'}`);
    breakCard && breakCard.close();
  }

  act('finish').addEventListener('click', () => finishSession('user'));

  let longCardOpen = false;
  function checkReturn() {
    if (longCardOpen) return;
    if (timer.checkLongPause()) {
      save([['sessions', timer.s]]);
      paintTimer();
      longCardOpen = true;
      const d = longPauseCard();
      const orig = d.close;
      d.close = (r) => { longCardOpen = false; orig(r); };
    }
  }

  function showBreak() {
    save([['sessions', timer.breakHandled()]]);
    const len = settings.break_len;
    breakCard = popCard({
      key: 'break', icon: icons.cup, tone: 'pop--break',
      title: 'Time for a stretch',
      text: `You've been knitting a while. Rest your hands for ${len} minutes? Your session keeps going.`,
      actions: [
        { label: `Start ${len} min break`, kind: 'butter', onClick: () => {
          breakEnds = Date.now() + len * 60000;
          return false;
        } },
        { label: 'Not now', kind: 'text', onClick: () => {} },
      ],
    });
    if (lock) lock.note('Time for a stretch break');
  }

  function tickBreak() {
    if (!breakEnds || !breakCard) return;
    const left = breakEnds - Date.now();
    const p = breakCard.querySelector('p');
    const actions = breakCard.querySelector('.pop__actions');
    if (left > 0) {
      p.textContent = `Break time left: ${fmtDuration(left)}`;
      actions.hidden = true;
    } else {
      breakEnds = 0;
      breakCard.querySelector('strong').textContent = 'Break’s over';
      p.textContent = 'Welcome back. Happy knitting!';
      setTimeout(() => breakCard && breakCard.close(), 6000);
    }
  }

  const tick = () => {
    const changed = timer.checkIdle();
    if (changed) save([['sessions', changed]]);
    if (timer.breakDue()) showBreak();
    paintTimer();
    paintLastTap();
    tickBreak();
  };
  const interval = setInterval(tick, 1000);

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      const s = timer.onLeave();
      if (s) save([['sessions', s]]);
    } else {
      tick();
      checkReturn();
    }
  };
  const onPageHide = () => { const s = timer.onLeave(); if (s) save([['sessions', s]]); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  /* ---------------- go ---------------- */

  renderOthers();
  paintAll();
  {
    const changed = timer.checkIdle();
    if (changed) save([['sessions', changed]]);
  }
  checkReturn();

  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    const s = timer.onLeave();
    if (s) save([['sessions', s]]);
    if (lock) { lock.close(); lock = null; }
  };
}
