// Home: greeting + Quick tools. The "Row counter" tile opens the Quick counter.

import * as db from '../db.js';
import { waveHeader } from '../ui/header.js';
import { icons } from '../ui/icons.js';
import { fmtLong } from '../ui/dom.js';
import { ensureQuickProject } from '../data/projects.js';
import { byUse } from '../data/counters.js';
import { openTimerSettings } from './timer-settings.js';
import { syncBadgeHTML, mountSyncBadge } from '../ui/sync-badge.js';

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Late-night loops';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export async function mount(root) {
  root.innerHTML = `
    ${waveHeader({
      left: syncBadgeHTML(),
      right: `<a class="icon-btn icon-btn--round" href="#/settings" aria-label="Settings">${icons.gear}</a>`,
    })}
    <main class="page">
      <h1 class="page-title page-title--left">${greeting()}, maker</h1>
      <p class="page-lede">Pick up your needles, we'll keep count.</p>

      <h2 class="section-title">Quick tools</h2>
      <div class="tiles">
        <a class="tile tile--butter tile--wide" href="#/counter" data-tile="counter">
          <span class="tile__icon">${icons.counter}</span>
          <span class="tile__text">
            <strong>Row counter</strong>
            <span class="tile__meta" data-meta>Count rows and stitches</span>
          </span>
          <span class="tile__count" data-count></span>
        </a>
        <button type="button" class="tile tile--blue" data-tile="timer">
          <span class="tile__icon">${icons.clock}</span>
          <span class="tile__text"><strong>Timer &amp; breaks</strong></span>
        </button>
        <a class="tile tile--lilac" href="#/patterns">
          <span class="tile__icon">${icons.patterns}</span>
          <span class="tile__text"><strong>Patterns</strong><span class="tile__meta">Coming soon</span></span>
        </a>
      </div>

      <div class="last-session" data-last hidden></div>
    </main>`;

  root.querySelector('[data-tile="timer"]').addEventListener('click', () => openTimerSettings());
  const stopBadge = mountSyncBadge(root);

  // Fill in live numbers (never blocks the first paint). Runs again after a sync brings news.
  async function fill() {
    try {
      const p = await ensureQuickProject();
      const counters = await db.byIndex('counters', 'project_id', p.id);
      const main = counters.filter((c) => c.is_main).sort(byUse)[0];
      if (!root.isConnected) return;
      root.querySelector('[data-count]').textContent = main ? main.value : '';
      root.querySelector('[data-meta]').textContent = !main ? 'Count rows and stitches'
        : main.target ? `${main.value} / ${main.target} ${main.name.toLowerCase()}`
          : `${main.name} so far`;
      const sessions = (await db.byIndex('sessions', 'project_id', p.id))
        .filter((s) => s.status === 'ended')
        .sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1));
      const last = sessions[0];
      const box = root.querySelector('[data-last]');
      box.hidden = !last;
      if (last) {
        const rows = Math.max(0, last.rows);
        box.innerHTML = `${icons.sparkle}<span>Last session: <strong>${fmtLong(last.active_ms)}</strong> of knitting, <strong>${rows}</strong> ${rows === 1 ? 'row' : 'rows'}.</span>`;
      }
    } catch (e) { console.error(e); }
  }
  const onData = () => fill();
  window.addEventListener('ld:data-changed', onData);
  await fill();

  return () => {
    stopBadge();
    window.removeEventListener('ld:data-changed', onData);
  };
}
