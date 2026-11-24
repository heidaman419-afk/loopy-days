// Small cloud + dot in the Home header showing the sync status. Calm on purpose.
// Hidden entirely while sync isn't set up.

import { icons } from './icons.js';
import { onStatus, describe } from '../sync/engine.js';

export const syncBadgeHTML = () =>
  `<a class="sync-badge" href="#/settings" data-sync-badge hidden aria-label="Sync status">
     <span class="sync-badge__cloud">${icons.cloud}</span><span class="sync-badge__dot"></span>
   </a>`;

/** Wire up a badge inside root. Returns a cleanup function. */
export function mountSyncBadge(root) {
  const a = root.querySelector('[data-sync-badge]');
  if (!a) return () => {};
  return onStatus((s) => {
    const d = describe(s);
    a.hidden = s.state === 'off';
    a.dataset.tone = d.tone;
    a.querySelector('.sync-badge__cloud').innerHTML = s.state === 'signed-out' ? icons.cloudOff : icons.cloud;
    a.setAttribute('aria-label', `Sync: ${d.text}`);
    a.title = d.text;
  });
}
