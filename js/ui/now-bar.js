// "Now knitting" bar: on tab screens, while a session is running or paused, a rounded
// bar sits just above the tab bar with play/pause, the project name, the state and the
// total time worked on that project. Tapping it opens that project's counter.

import * as db from '../db.js';
import { el, esc, fmtDuration } from './dom.js';
import { icons } from './icons.js';
import { SessionTimer, sessionNow, loadTimerSettings } from '../data/timer.js';

export function startNowBar() {
  const bar = el(`
    <div class="now-bar" hidden>
      <button type="button" class="now-bar__btn" data-toggle aria-label="Pause"></button>
      <a class="now-bar__main" data-open href="#/counter">
        <span class="now-bar__text"><strong data-name></strong><span data-state></span></span>
        <span class="now-bar__time"><span>Total</span><strong data-time></strong></span>
        <span class="now-bar__chev">${icons.chevronRight}</span>
      </a>
    </div>`);
  document.getElementById('tabbar').before(bar);

  let current = null; // { s, project, settings, others }
  let busy = false;

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const settings = await loadTimerSettings();
      const open = (await db.getAll('sessions')).filter((s) => s.status === 'running' || s.status === 'paused');
      open.sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0));
      let found = null;
      for (const s of open) {
        const p = await db.get('projects', s.project_id);
        if (p && !p.deleted && !p.draft) { found = { s, project: p }; break; }
      }
      if (!found) { show(false); current = null; return; }
      // Apply auto-pause / 4-hour rules here too, so a forgotten timer doesn't tick forever.
      const t = new SessionTimer(found.project.id, settings, found.s);
      const before = found.s.status;
      t.checkIdle();
      if (found.s.status === 'running') t.checkLongPause();
      if (found.s.status !== before) await db.put('sessions', found.s);
      const all = await db.byIndex('sessions', 'project_id', found.project.id);
      const others = all.filter((x) => x.id !== found.s.id).reduce((n, x) => n + sessionNow(x, settings).ms, 0);
      current = { ...found, settings, others };
      paint();
      show(true);
    } catch (e) {
      console.error(e);
    } finally { busy = false; }
  }

  function show(on) {
    bar.hidden = !on;
    document.body.classList.toggle('has-nowbar', on);
  }

  function paint() {
    if (!current) return;
    const { s, project, settings, others } = current;
    const now = sessionNow(s, settings);
    const running = now.state === 'running';
    bar.dataset.state = running ? 'running' : 'paused';
    const btn = bar.querySelector('[data-toggle]');
    btn.innerHTML = running ? icons.pause : icons.play;
    btn.setAttribute('aria-label', running ? 'Pause the timer' : 'Carry on with the timer');
    const name = project.kind === 'quick' ? 'Quick counter' : (project.name || 'Untitled project');
    bar.querySelector('[data-name]').textContent = name;
    bar.querySelector('[data-state]').textContent = running ? 'Knitting' : 'Paused';
    bar.querySelector('[data-time]').textContent = fmtDuration(others + now.ms);
    bar.querySelector('[data-open]').href = project.kind === 'quick' ? '#/counter' : `#/counter/${project.id}`;
    bar.querySelector('[data-open]').setAttribute('aria-label', `${esc(name)}, ${running ? 'knitting' : 'paused'}. Open its counter`);
  }

  bar.querySelector('[data-toggle]').addEventListener('click', async () => {
    if (!current) return;
    const { s, project, settings } = current;
    const t = new SessionTimer(project.id, settings, s);
    if (sessionNow(s, settings).state === 'running') t.pause(Date.now(), 'user');
    else t.resume(Date.now());
    await db.put('sessions', s);
    paint();
  });

  let soon = null;
  const later = () => { clearTimeout(soon); soon = setTimeout(refresh, 300); };
  window.addEventListener('hashchange', later);
  window.addEventListener('ld:local-write', later);
  window.addEventListener('ld:data-changed', later);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later(); });
  setInterval(() => {
    if (!current || bar.hidden || document.visibilityState !== 'visible') return;
    if (sessionNow(current.s, current.settings).state !== bar.dataset.state) refresh(); // went quiet
    else paint();
  }, 1000);
  refresh();
}
