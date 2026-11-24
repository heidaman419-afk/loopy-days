// Loopy Days - app start-up: tab bar, router, offline support.

import { startRouter } from './router.js';
import { icons } from './ui/icons.js';
import { openDB, askPersistentStorage } from './db.js';
import * as home from './screens/home.js';
import * as counter from './screens/counter.js';
import { placeholder } from './screens/placeholder.js';

const TABS = [
  ['home', 'Home', icons.home],
  ['stash', 'Stash', icons.stash],
  ['projects', 'Projects', icons.projects],
  ['patterns', 'Patterns', icons.patterns],
  ['activity', 'Activity', icons.activity],
];

const routes = {
  home,
  stash: placeholder('stash'),
  projects: placeholder('projects'),
  patterns: placeholder('patterns'),
  activity: placeholder('activity'),
  counter,
};

function buildTabBar() {
  const nav = document.getElementById('tabbar');
  nav.innerHTML = TABS.map(([key, label, icon]) =>
    `<a class="tab" href="#/${key}" data-tab="${key}">${icon}<span>${label}</span></a>`).join('');
  return (active) => {
    for (const a of nav.querySelectorAll('.tab')) {
      const on = a.dataset.tab === active;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  };
}

async function boot() {
  const setActiveTab = buildTabBar();
  try { await openDB(); } catch (e) {
    console.error(e);
    document.getElementById('outlet').innerHTML =
      '<p class="error-note">Loopy Days can’t save on this device right now (private browsing?). Counts won’t be kept.</p>';
  }
  startRouter({ outlet: document.getElementById('outlet'), routes, fallback: 'home', onChange: setActiveTab });
  askPersistentStorage();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch((e) => console.warn('Offline support unavailable', e));
  }
}

boot();
