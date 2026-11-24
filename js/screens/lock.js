// Lock mode: the whole screen is one giant +1 button. Hold the small unlock
// button for one second to leave. Keeps the screen awake where supported.

import { el, esc } from '../ui/dom.js';
import { icons } from '../ui/icons.js';

const HOLD_MS = 1000;

export function openLock({ onPlus, onExit }) {
  const node = el(`
    <div class="lock" role="application" aria-label="Lock mode. Tap anywhere to add one.">
      <div class="lock__top">
        <span class="lock__timer" data-timer></span>
        <button type="button" class="lock__unlock" data-unlock aria-label="Hold for one second to unlock">
          <svg class="lock__ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/></svg>
          ${icons.unlock}
        </button>
      </div>
      <div class="lock__center">
        <p class="lock__label" data-label></p>
        <p class="lock__num" data-num>0</p>
        <div class="lock__goal" data-goal hidden>
          <span data-goal-text></span>
          <div class="bar"><span class="bar__fill" data-goal-bar></span></div>
        </div>
        <p class="lock__note" data-note hidden></p>
      </div>
      <p class="lock__hint" data-hint>Tap anywhere to add a row · hold ${icons.unlock} to unlock</p>
      <div class="lock__flash" data-flash aria-hidden="true"></div>
    </div>`);
  document.body.appendChild(node);
  document.body.classList.add('is-locked');

  const $ = (s) => node.querySelector(s);
  const unlockBtn = $('[data-unlock]');
  let holdTimer = null;
  let closed = false;

  // Whole surface = +1 on pointerdown (instant).
  node.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-unlock]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    onPlus();
    const f = $('[data-flash]');
    f.classList.remove('is-on'); void f.offsetWidth; f.classList.add('is-on');
  });
  node.addEventListener('contextmenu', (e) => e.preventDefault());
  // iPhone Safari zooms on fast double taps and pinches; stop that while locked.
  // (Pointer events above still fire, so every tap still counts.)
  const noZoom = (e) => { if (!e.target.closest('[data-unlock]')) e.preventDefault(); };
  node.addEventListener('touchend', noZoom, { passive: false });
  node.addEventListener('dblclick', (e) => e.preventDefault());
  const noGesture = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, noGesture, { passive: false }));
  // Keyboard: Space/Enter adds one too.
  const onKey = (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && document.activeElement !== unlockBtn) { e.preventDefault(); onPlus(); }
  };
  document.addEventListener('keydown', onKey);

  const cancelHold = () => {
    clearTimeout(holdTimer); holdTimer = null;
    unlockBtn.classList.remove('is-holding');
  };
  unlockBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    try { unlockBtn.setPointerCapture(e.pointerId); } catch {}
    unlockBtn.classList.add('is-holding');
    holdTimer = setTimeout(() => { holdTimer = null; finish(); }, HOLD_MS);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => unlockBtn.addEventListener(t, cancelHold));
  unlockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.detail === 0) finish(false); // keyboard users: Enter on the button unlocks
  });

  // Screen Wake Lock (iOS 16.4+ in home-screen apps; silently skipped elsewhere).
  let wake = null;
  const askWake = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !closed) {
        wake = await navigator.wakeLock.request('screen');
      }
    } catch { wake = null; }
  };
  const onVis = () => { if (document.visibilityState === 'visible') askWake(); };
  document.addEventListener('visibilitychange', onVis);
  askWake();

  function finish(fromFinger = true) {
    if (closed) return;
    closed = true;
    if (fromFinger) {
      // Swallow the finger's trailing click so it can't hit a button underneath.
      const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
      const off = () => document.removeEventListener('click', stop, true);
      document.addEventListener('click', stop, true);
      document.addEventListener('pointerup', () => setTimeout(off, 400), { once: true, capture: true });
      setTimeout(off, 2500);
    }
    api.close();
    onExit && onExit();
  }

  const api = {
    paint({ label, value, goalText, goalPct, timerText }) {
      $('[data-label]').textContent = label;
      $('[data-num]').textContent = value;
      const g = $('[data-goal]');
      g.hidden = !goalText;
      if (goalText) {
        $('[data-goal-text]').textContent = goalText;
        $('[data-goal-bar]').style.width = `${goalPct}%`;
      }
      $('[data-timer]').textContent = timerText || '';
      $('[data-hint]').innerHTML = `Tap anywhere to add ${label ? 'one' : 'a row'} · hold ${icons.unlock} to unlock`;
    },
    setNumber(v) { $('[data-num]').textContent = v; },
    setTimer(t) { $('[data-timer]').textContent = t; },
    note(text) {
      const n = $('[data-note]');
      n.hidden = !text;
      n.innerHTML = text ? `${icons.bell}<span>${esc(text)}</span>` : '';
    },
    close() {
      closed = true;
      cancelHold();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
      ['gesturestart', 'gesturechange'].forEach((t) => document.removeEventListener(t, noGesture));
      if (wake) { wake.release().catch(() => {}); wake = null; }
      document.body.classList.remove('is-locked');
      node.remove();
    },
  };
  return api;
}
