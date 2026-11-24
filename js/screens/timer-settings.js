// "Timer & breaks" bottom sheet. Opened from the counter's gear and from Home.

import { openSheet } from '../ui/overlay.js';
import { el, esc } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { loadTimerSettings, saveTimerSettings } from '../data/timer.js';

const MODES = [
  ['keep', 'Always keep going',
    'The clock carries on while you put the phone down or switch apps. Handy when you knit long rows.'],
  ['pause_on_leave', 'Stop when I leave',
    'The clock stops as soon as you leave this screen or the app, so only hands-on time counts.'],
  ['auto_pause', 'Stop when I go quiet',
    'The clock stops by itself when you haven\'t tapped for a while, so a forgotten timer can\'t run all night.'],
];
const IDLE = [10, 15, 20, 30, 45];
const EVERY = [[30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']];
const LENGTH = [3, 5, 10, 15];

/** onChange(settings) is called after every change (already saved). */
export async function openTimerSettings(current, onChange) {
  const s = current || (await loadTimerSettings());

  const chips = (name, list, value) => list.map(([v, label]) => `
    <button type="button" class="chip ${v === value ? 'is-on' : ''}" data-${name}="${v}" aria-pressed="${v === value}">${esc(label)}</button>`).join('');

  const body = el('<div class="settings"></div>');
  const render = () => {
    body.innerHTML = `
      <section class="settings__group">
        <h3 class="settings__h">When the clock runs</h3>
        <p class="settings__p">Pick what the session timer does while you're away from the counter.</p>
        <div class="option-list" role="radiogroup" aria-label="Timer behaviour">
          ${MODES.map(([v, t, d]) => `
            <button type="button" class="option ${s.mode === v ? 'is-on' : ''}" role="radio" aria-checked="${s.mode === v}" data-mode="${v}">
              <span class="option__text"><strong>${esc(t)}</strong><span>${esc(d)}</span></span>
              <span class="option__tick" aria-hidden="true">${icons.check}</span>
            </button>`).join('')}
        </div>
        ${s.mode === 'auto_pause' ? `
          <h4 class="settings__h4">Stop after no taps for</h4>
          <div class="chips">${chips('idle', IDLE.map((m) => [m, `${m} min`]), s.idle_min)}</div>` : ''}
      </section>

      <section class="settings__group">
        <div class="settings__row">
          <div>
            <h3 class="settings__h">Stretch breaks</h3>
            <p class="settings__p">A soft nudge to rest your hands and eyes. Your session keeps going.</p>
          </div>
          <label class="switch">
            <input type="checkbox" data-breaks ${s.breaks ? 'checked' : ''} aria-label="Stretch breaks">
            <span class="switch__track"><span class="switch__dot"></span></span>
          </label>
        </div>
        <div class="settings__sub ${s.breaks ? '' : 'is-off'}">
          <h4 class="settings__h4">Nudge me every</h4>
          <div class="chips">${chips('every', EVERY, s.break_every)}</div>
          <h4 class="settings__h4">Break length</h4>
          <div class="chips">${chips('len', LENGTH.map((m) => [m, `${m} min`]), s.break_len)}</div>
        </div>
      </section>

      <p class="info-note">${icons.info}<span>${esc(summary(s))}</span></p>`;
  };

  const commit = () => { render(); saveTimerSettings(s); onChange && onChange(s); };

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode],[data-idle],[data-every],[data-len]');
    if (!b) return;
    if (b.dataset.mode) s.mode = b.dataset.mode;
    if (b.dataset.idle) s.idle_min = +b.dataset.idle;
    if (b.dataset.every) s.break_every = +b.dataset.every;
    if (b.dataset.len) s.break_len = +b.dataset.len;
    commit();
  });
  body.addEventListener('change', (e) => {
    if (e.target.matches('[data-breaks]')) { s.breaks = e.target.checked; commit(); }
  });

  render();
  return openSheet({ title: 'Timer & breaks', body, className: 'sheet--tall' });
}

function summary(s) {
  if (s.mode === 'keep') return 'Your timer keeps running until you pause it. After four quiet hours it stops on its own.';
  if (s.mode === 'pause_on_leave') return 'Your timer stops whenever you leave the counter or put the app in the background.';
  return `Your timer stops after ${s.idle_min} minutes without a tap. Tap +1 to carry on.`;
}
