// Home: greeting + Quick tools. The "Row counter" tile opens the Quick counter.

import * as db from '../db.js';
import { waveHeader } from '../ui/header.js';
import { icons } from '../ui/icons.js';
import { fmtLong } from '../ui/dom.js';
import { ensureQuickProject } from '../data/projects.js';
import { openTimerSettings } from './timer-settings.js';

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Late-night loops';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export async function mount(root) {
  root.innerHTML = `
    ${waveHeader()}
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

  // Fill in live numbers (never blocks the first paint).
  try {
    const p = await ensureQuickProject();
    const counters = await db.byIndex('counters', 'project_id', p.id);
    const main = counters.find((c) => c.is_main);
    if (main && root.isConnected) {
      root.querySelector('[data-count]').textContent = main.value;
      root.querySelector('[data-meta]').textContent = main.target
        ? `${main.value} / ${main.target} ${main.name.toLowerCase()}`
        : `${main.name} so far`;
    }
    const sessions = (await db.byIndex('sessions', 'project_id', p.id))
      .filter((s) => s.status === 'ended')
      .sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1));
    const last = sessions[0];
    if (last && root.isConnected) {
      const box = root.querySelector('[data-last]');
      box.hidden = false;
      const rows = Math.max(0, last.rows);
      box.innerHTML = `${icons.sparkle}<span>Last session: <strong>${fmtLong(last.active_ms)}</strong> of knitting, <strong>${rows}</strong> ${rows === 1 ? 'row' : 'rows'}.</span>`;
    }
  } catch (e) { console.error(e); }
}
