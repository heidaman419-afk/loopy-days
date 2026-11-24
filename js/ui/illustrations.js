// Own illustrations in the brand guide's soft hand-drawn style (cocoa outlines,
// pastel fills) plus the knit-texture background and the progress ring.

const C = '#403833';     // dark cocoa
const PINK = '#DFC4CA';
const BUTTER = '#E8DCC0';
const BLUE = '#B9CBD8';
const CREAM = '#F5F3F0';
const SAGE = '#C1CBB5';
const LILAC = '#E0D7E5';

const wrap = (size, body, vb = '0 0 96 96') =>
  `<svg class="illo" width="${size}" height="${size}" viewBox="${vb}" aria-hidden="true" fill="none" stroke="${C}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Basket with yarn balls and needles (Projects header + empty state + tour 1). */
export const basket = (size = 56) => wrap(size, `
  <path d="M30 34 41 10M42 34l-2-26" />
  <circle cx="41" cy="9" r="3" fill="${PINK}"/><circle cx="40" cy="7" r="3" fill="${BUTTER}"/>
  <circle cx="34" cy="42" r="12" fill="${PINK}"/>
  <path d="M24 38c5 0 10 3 12 10M26 46c4-1 8 1 10 5M30 32c3 3 5 7 5 13"/>
  <circle cx="58" cy="41" r="13" fill="${BLUE}"/>
  <path d="M47 37c5 0 11 3 13 11M50 48c4-1 9 1 11 5M56 29c3 3 5 8 4 14"/>
  <circle cx="46" cy="47" r="9" fill="${BUTTER}"/>
  <path d="M38 46c4 0 8 2 9 7M43 39c2 2 4 6 3 10"/>
  <path d="M16 50h64l-6 30c-.6 3-3 5-6 5H28c-3 0-5.4-2-6-5z" fill="${BUTTER}"/>
  <path d="M14 50h68" stroke-width="3.2"/>
  <path d="M24 60h48M26 70h44M33 50v35M48 50v35M63 50v35" stroke-width="2"/>`);

/** Sweater and sock: "make anything" (tour 2). */
export const garments = (size = 120) => wrap(size, `
  <path d="M22 26 12 32l-4 18 9 3 3-9v32h34V44l3 9 9-3-4-18-10-6" fill="${PINK}"/>
  <path d="M22 26c2 4 6 6 11 6s9-2 11-6" fill="${CREAM}"/>
  <path d="M26 46h22M26 54h22M26 62h22" stroke-width="2" stroke-dasharray="3 4"/>
  <path d="M66 30h16v30c0 4 1 6 4 9 4 4 2 12-6 12-4 0-6-2-9-5l-7-7c-3-3-4-6-4-9V30z" fill="${BLUE}"/>
  <path d="M64 30h20" stroke-width="3.2"/>
  <path d="M66 38h16M66 44h16" stroke-width="2"/>`);

/** Counter with a little clock (tour 3). */
export const counterClock = (size = 120) => wrap(size, `
  <rect x="16" y="22" width="46" height="52" rx="12" fill="${BUTTER}"/>
  <rect x="24" y="32" width="30" height="22" rx="6" fill="${CREAM}"/>
  <path d="M33 39l3-2v12M41 39.5c1-1.5 2.4-2.4 4-2.4 2.2 0 3.6 1.4 3.6 3.2 0 3-7.2 4.8-7.2 9.2H49" stroke-width="2.4"/>
  <circle cx="31" cy="64" r="4" fill="${PINK}"/><circle cx="47" cy="64" r="4" fill="${PINK}"/>
  <path d="M39 22v-8" /><circle cx="39" cy="11" r="3.4" fill="${PINK}"/>
  <circle cx="70" cy="62" r="17" fill="${BLUE}"/>
  <path d="M70 52v10l7 5"/>`);

/** Camera with a heart (tour 4). */
export const cameraHeart = (size = 120) => wrap(size, `
  <path d="M14 36c0-4 3-7 7-7h9l5-8h22l5 8h9c4 0 7 3 7 7v32c0 4-3 7-7 7H21c-4 0-7-3-7-7z" fill="${LILAC}"/>
  <circle cx="48" cy="52" r="15" fill="${CREAM}"/>
  <path d="M48 60s-8-4.8-8-10a4.4 4.4 0 0 1 8-2.4 4.4 4.4 0 0 1 8 2.4c0 5.2-8 10-8 10z" fill="${PINK}"/>
  <circle cx="72" cy="38" r="2.4" fill="${C}"/>
  <path d="M80 18l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="${SAGE}" stroke-width="2"/>`);

// The soft V-stitch knit texture lives in css/projects.css (.knit-texture).

/** Circular progress ring with the % in the middle. */
export function ring(pct, { size = 56, stroke = 5, cls = '' } = {}) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const off = len * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<span class="ring ${cls}" style="width:${size}px;height:${size}px" role="img" aria-label="${pct}% done">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
      <circle class="ring__fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"
        stroke-linecap="round" stroke-dasharray="${len.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <span class="ring__pct">${pct}%</span>
  </span>`;
}
