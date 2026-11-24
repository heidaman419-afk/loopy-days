// The pink wave header used across screens.

import { icons, yarnMark } from './icons.js';
import { esc } from './dom.js';

/**
 * left / right: optional HTML for the corner buttons.
 * brand: show "Loopy Days" next to the mark (tab screens), or just the mark (counter).
 */
export function waveHeader({ left = '', right = '', brand = true } = {}) {
  return `
  <header class="wave-head">
    <div class="wave-head__bar">
      <div class="wave-head__side">${left}</div>
      <div class="wave-head__brand">
        ${yarnMark(brand ? 34 : 46)}
        ${brand ? '<span class="wave-head__name">Loopy Days</span>' : ''}
      </div>
      <div class="wave-head__side wave-head__side--right">${right}</div>
    </div>
    <svg class="wave-head__wave" viewBox="0 0 390 34" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0H390V16C352 26 318 30 268 22 212 13 170 4 118 10 70 15 34 30 0 22Z"/>
    </svg>
  </header>`;
}

export const backButton = (label = 'Back') =>
  `<button type="button" class="icon-btn" data-act="back" aria-label="${esc(label)}">${icons.back}</button>`;
