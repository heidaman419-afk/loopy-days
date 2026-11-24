// First-time Projects tour: swipeable cards, dots, Next / Skip / Got it.

import { el, esc } from '../ui/dom.js';
import { basket, garments, counterClock, cameraHeart } from '../ui/illustrations.js';
import * as db from '../db.js';

export const TOUR_KEY = 'projects_tour_seen';

const CARDS = [
  [basket(120), 'Your projects live here', 'Every make gets its own little home: its count, the time you put in, photos and notes, all in one place.'],
  [garments(120), 'Track anything you make', 'A cardigan, a dishcloth, a pair of socks. Start with just a name. Patterns will plug in later on.'],
  [counterClock(120), 'Its own counter and timer', 'Tap “Start knitting” on a project. Its rows and time are kept apart from your Quick counter and every other project.'],
  [cameraHeart(120), 'Snap your progress', 'Add photos as you go and choose your favourite as the cover. They sync to your other devices when you’re signed in.'],
];

export async function shouldShowTour() {
  return !(await db.getSetting(TOUR_KEY, false));
}

/** Opens the tour; resolves when it's closed. Marks it as seen. */
export function openTour() {
  return new Promise((resolve) => {
    const node = el(`
      <div class="tour" role="dialog" aria-modal="true" aria-label="Welcome to projects">
        <button type="button" class="tour__skip" data-skip>Skip</button>
        <div class="tour__track" data-track>
          ${CARDS.map(([art, title, text], i) => `
            <section class="tour__card" aria-roledescription="slide" aria-label="${i + 1} of ${CARDS.length}">
              <div class="tour__inner">
                <div class="tour__art">${art}</div>
                <h2 class="tour__title">${esc(title)}</h2>
                <p class="tour__text">${esc(text)}</p>
              </div>
            </section>`).join('')}
        </div>
        <div class="tour__dots" aria-hidden="true">${CARDS.map(() => '<span></span>').join('')}</div>
        <button type="button" class="btn btn--butter tour__next" data-next>Next</button>
      </div>`);
    document.body.appendChild(node);
    const track = node.querySelector('[data-track]');
    const dots = [...node.querySelectorAll('.tour__dots span')];
    const next = node.querySelector('[data-next]');
    let index = 0;

    const paint = () => {
      dots.forEach((d, i) => d.classList.toggle('is-on', i === index));
      const last = index === CARDS.length - 1;
      next.textContent = last ? 'Got it' : 'Next';
      node.querySelector('[data-skip]').hidden = last;
    };
    const goTo = (i) => {
      index = Math.max(0, Math.min(CARDS.length - 1, i));
      track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
      paint();
    };
    const finish = () => {
      db.setSetting(TOUR_KEY, true).catch(() => {});
      node.classList.add('is-closing');
      setTimeout(() => node.remove(), 160);
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== index) { index = i; paint(); }
    }, { passive: true });
    next.addEventListener('click', () => (index === CARDS.length - 1 ? finish() : goTo(index + 1)));
    node.querySelector('[data-skip]').addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
    paint();
    requestAnimationFrame(() => next.focus({ preventScroll: true }));
  });
}
