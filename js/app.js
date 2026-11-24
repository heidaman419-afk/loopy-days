// Loopy Days - app start-up: tab bar, router, offline support, sync.

import { startRouter } from './router.js';
import { icons } from './ui/icons.js';
import { openDB, askPersistentStorage } from './db.js';
import * as home from './screens/home.js';
import * as counter from './screens/counter.js';
import * as settings from './screens/settings.js';
import { placeholder } from './screens/placeholder.js';
import { startSync } from './sync/engine.js';
import { catchRecoveryLink } from './sync/auth.js';
import { toast } from './ui/overlay.js';

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
  settings,
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

// Start saving the offline copy straight away, before anything else loads.
// The first time it finishes on this device, say so, so you know it's safe to go offline.
function startOffline() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const firstTime = !navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { scope: './' })
    .catch((e) => console.warn('Offline support unavailable', e));
  if (firstTime) {
    navigator.serviceWorker.ready.then(() => {
      if (localStorage.getItem('ld-offline-ready')) return;
      localStorage.setItem('ld-offline-ready', '1');
      toast('Ready to use offline', { ms: 4000 });
    });
  }
}

async function boot() {
  catchRecoveryLink(); // opened from a password-reset email? go to Settings first
  startOffline();
  const setActiveTab = buildTabBar();
  try { await openDB(); } catch (e) {
    console.error(e);
    document.getElementById('outlet').innerHTML =
      '<p class="error-note">Loopy Days can’t save on this device right now (private browsing?). Counts won’t be kept.</p>';
  }
  startRouter({ outlet: document.getElementById('outlet'), routes, fallback: 'home', onChange: setActiveTab });
  askPersistentStorage();
  // Online sync: does nothing until config.js is filled in and someone signs in.
  try { startSync(); } catch (e) { console.error(e); }
}

boot();
