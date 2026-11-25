// Home: greeting + Quick tools. The "Row counter" tile opens the Quick counter.

import * as db from '../db.js';
import { waveHeader } from '../ui/header.js';
import { icons } from '../ui/icons.js';
import { fmtLong } from '../ui/dom.js';
import { ensureQuickProject, listProjects, mainCounterOf, lastWorked, progressOf, statusOf, statusLabel, craftOf, craftLabel } from '../data/projects.js';
import { byUse } from '../data/counters.js';
import { esc, timeAgo } from '../ui/dom.js';
import { ring, basket } from '../ui/illustrations.js';
import { thumbUrl } from '../data/photos.js';
import { knitTarget } from '../patterns/ui.js';

/** The most recently worked project (no Quick counter, no drafts), or null. */
async function heroProject() {
  const list = await listProjects();
  let best = null;
  for (const p of list) {
    const main = await mainCounterOf(p.id);
    const worked = lastWorked(p, main);
    // Worked-on projects always beat untouched ones; among untouched, the newest wins.
    const key = worked ? `1${worked}` : `0${p.created_at || ''}`;
    if (!best || key > best.key) best = { p, main, worked, key };
  }
  return best;
}

async function paintHero(slot) {
  const h = await heroProject();
  if (!slot.isConnected) return;
  if (!h) {
    slot.innerHTML = `
      <article class="hero hero--empty">
        <div class="hero__text">
          <p class="hero__eyebrow">Your projects</p>
          <h2 class="hero__name">Start your first project</h2>
          <p class="hero__meta">Give it a name and it gets its own counter, timer and photos.</p>
          <a class="hero__pill" href="#/project-new">${icons.plus}<span>Start a project</span></a>
        </div>
        <div class="hero__art">${basket(110)}</div>
      </article>`;
    return;
  }
  const { p, main, worked } = h;
  const kt = await knitTarget(p);
  const st = statusOf(p);
  const pct = progressOf(p, main);
  const started = (main && main.value > 0) || !!worked;
  slot.innerHTML = `
    <article class="hero ${p.cover_photo_id ? 'has-photo' : ''}">
      <div class="hero__photo" data-hero-photo></div>
      <div class="hero__text">
        <p class="hero__eyebrow">${esc(craftLabel(craftOf(p)))} · ${esc(statusLabel(st))}</p>
        <h2 class="hero__name">${esc(p.name || 'Untitled project')}</h2>
        <p class="hero__meta">${worked ? `Last worked ${esc(timeAgo(worked))}` : 'Not started yet'}</p>
        <a class="hero__pill" href="${kt.href}">${icons.play}<span>${kt.guide ? 'Follow guide' : started ? 'Keep knitting' : 'Start knitting'}</span></a>
      </div>
      ${ring(pct, { size: 64, stroke: 6, cls: 'hero__ring' })}
      <a class="hero__link" href="#/project/${p.id}" aria-label="Open ${esc(p.name || 'project')}"></a>
    </article>`;
  if (p.cover_photo_id) {
    const u = await thumbUrl(p.cover_photo_id);
    const ph = slot.querySelector('[data-hero-photo]');
    if (u && ph) ph.style.backgroundImage = `url("${u}")`;
  }
}
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

      <div class="hero-slot" data-hero></div>

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
    paintHero(root.querySelector('[data-hero]')).catch((e) => console.error(e));
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
  window.addEventListener('ld:files-changed', onData);
  await fill();

  return () => {
    stopBadge();
    window.removeEventListener('ld:data-changed', onData);
    window.removeEventListener('ld:files-changed', onData);
  };
}
