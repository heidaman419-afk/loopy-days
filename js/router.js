// Hash router: #/home, #/stash, #/projects, #/patterns, #/activity, #/counter[/<projectId>]
// A screen module exports `mount(container, params) -> cleanup function` and
// optionally `fullscreen = true` (hides the tab bar).

import { closeAll } from './ui/overlay.js';

export function startRouter({ outlet, routes, fallback = 'home', onChange }) {
  let cleanup = null;
  let token = 0;

  async function go() {
    const parts = (location.hash.replace(/^#\/?/, '') || fallback).split('/').filter(Boolean);
    const name = routes[parts[0]] ? parts[0] : fallback;
    const screen = routes[name];
    const my = ++token;

    closeAll();
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    outlet.replaceChildren();
    document.body.classList.toggle('is-fullscreen', !!screen.fullscreen);
    document.body.dataset.screen = name;
    onChange && onChange(name);

    const container = document.createElement('div');
    container.className = `screen screen--${name}`;
    outlet.appendChild(container);
    try {
      const c = await screen.mount(container, parts.slice(1));
      if (my !== token) { c && c(); return; } // user already moved on
      cleanup = c || null;
    } catch (e) {
      console.error(e);
      container.innerHTML = '<p class="error-note">Something went wrong opening this screen. Please go back and try again.</p>';
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', go);
  go();
  return { go };
}

export const navigate = (path) => { location.hash = path; };
