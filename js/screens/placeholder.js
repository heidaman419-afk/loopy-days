// Friendly "arriving soon" screens for tabs that later features will fill.

import { waveHeader } from '../ui/header.js';
import { icons } from '../ui/icons.js';

const COPY = {
  stash: ['Yarn stash', 'A cosy shelf for every skein you own, with colours, weights and how much is left.', 'stash'],
  projects: ['Projects', 'All your makes in one place, each with its own counters, notes and progress.', 'projects'],
  patterns: ['Patterns', 'Keep your patterns close and follow them step by step while you knit.', 'patterns'],
  activity: ['Activity', 'See how many rows and hours you knitted each day and week.', 'activity'],
};

export function placeholder(key) {
  return {
    mount(root) {
      const [title, text, icon] = COPY[key];
      root.innerHTML = `
        ${waveHeader()}
        <main class="page">
          <h1 class="page-title page-title--left">${title}</h1>
          <section class="empty">
            <div class="empty__art" aria-hidden="true">${icons[icon]}</div>
            <h2 class="empty__title">Arriving soon</h2>
            <p class="empty__text">${text}</p>
            <a class="btn btn--butter" href="#/counter">Open the row counter</a>
          </section>
        </main>`;
    },
  };
}
