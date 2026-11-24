// Hand-drawn style line icons (own drawings). Stroke uses currentColor.
// Soft round caps and joins, slightly wobbly curves to match the brand guide.

const svg = (body, { vb = '0 0 24 24', sw = 1.8, cls = '' } = {}) =>
  `<svg class="ico ${cls}" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  back: svg('<path d="M15.2 4.8 8.4 11.7c-.2.2-.2.5 0 .7l6.8 6.8"/>', { sw: 2.2 }),
  close: svg('<path d="M6.3 6.2 17.8 17.7M17.7 6.3 6.2 17.8"/>', { sw: 2.1 }),
  gear: svg('<circle cx="12" cy="12" r="3.1"/><path d="M12 2.9l1.6.2.5 2.2 1.7.8 1.9-1.2 2.2 2.2-1.2 1.9.7 1.7 2.3.5v3.2l-2.3.5-.7 1.7 1.2 1.9-2.2 2.2-1.9-1.2-1.7.7-.5 2.3h-3.2l-.5-2.3-1.7-.7-1.9 1.2-2.2-2.2 1.2-1.9-.7-1.7-2.3-.5v-3.2l2.3-.5.7-1.7-1.2-1.9 2.2-2.2 1.9 1.2 1.7-.8.5-2.2z"/>', { sw: 1.7 }),
  pencil: svg('<path d="M4.5 19.6l1-4.1L15.9 5.1c.8-.8 2-.8 2.8 0l.2.2c.8.8.8 2 0 2.8L8.5 18.5z"/><path d="M14 7l3 3"/>'),
  plus: svg('<path d="M12 5.2v13.6M5.2 12h13.6"/>', { sw: 2.2 }),
  minus: svg('<path d="M5.2 12.1h13.6"/>', { sw: 2.2 }),
  plusCircle: svg('<circle cx="12" cy="12" r="9.2"/><path d="M12 8v8M8 12h8"/>'),
  play: svg('<path d="M8 5.6v12.8c0 .5.5.8.9.5l9.6-6.3c.4-.3.4-.8 0-1.1L8.9 5.1c-.4-.3-.9 0-.9.5z" fill="currentColor"/>', { sw: 1.2 }),
  pause: svg('<rect x="6.6" y="5.2" width="3.6" height="13.6" rx="1.4" fill="currentColor"/><rect x="13.8" y="5.2" width="3.6" height="13.6" rx="1.4" fill="currentColor"/>', { sw: 0.8 }),
  reset: svg('<path d="M19.4 12.6A7.4 7.4 0 1 1 16.9 6.4"/><path d="M17.6 2.9l-.4 3.9-3.9-.3"/>'),
  flag: svg('<path d="M6 21V4"/><path d="M6 4.6c2.2-1.3 4.2-.9 6 .1s3.9 1.5 6-.1v9c-2.1 1.6-4.2 1.1-6 .1s-3.8-1.4-6-.1"/>'),
  undo: svg('<path d="M9.2 5.3 4.4 10l4.8 4.6"/><path d="M4.8 10h8.7c3.4 0 6.1 2.6 6.1 5.9 0 1.2-.3 2.2-.9 3.2"/>'),
  trash: svg('<path d="M4.6 6.6h14.8"/><path d="M9.4 6.4V4.7c0-.6.5-1 1-1h3.2c.6 0 1 .4 1 1v1.7"/><path d="M6.4 6.8l.9 12.6c.1 1 .9 1.7 1.9 1.7h5.6c1 0 1.8-.7 1.9-1.7l.9-12.6"/><path d="M10.2 10.4v6.8M13.8 10.4v6.8"/>'),
  phoneLock: svg('<rect x="6.4" y="2.8" width="11.2" height="18.4" rx="2.6"/><path d="M10.6 18.2h2.8"/><rect x="9.6" y="9.8" width="4.8" height="3.8" rx=".9"/><path d="M10.6 9.8V8.6a1.4 1.4 0 0 1 2.8 0v1.2"/>'),
  note: svg('<path d="M5.4 3.6h9.4l3.8 3.8v12c0 .6-.4 1-1 1H5.4c-.6 0-1-.4-1-1V4.6c0-.6.4-1 1-1z"/><path d="M14.6 3.8v3.9h3.8"/><path d="M8 12h7.6M8 15.6h5.2"/>'),
  bell: svg('<path d="M6.2 16.6V11a5.8 5.8 0 0 1 11.6 0v5.6l1.6 1.8H4.6z"/><path d="M10 20.6c.5.7 1.2 1 2 1s1.5-.3 2-1"/>'),
  check: svg('<path d="M5.2 12.6l4.4 4.4 9.2-9.6"/>', { sw: 2.2 }),
  clock: svg('<circle cx="12" cy="12.4" r="8.4"/><path d="M12 7.6v5l3.2 2"/>'),
  info: svg('<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>'),
  cup: svg('<path d="M5 9.4h11.2v5.2a4.6 4.6 0 0 1-4.6 4.6h-2a4.6 4.6 0 0 1-4.6-4.6z"/><path d="M16.2 10.6h1.4a2.4 2.4 0 0 1 0 4.8h-1.6"/><path d="M8.4 3.6c-.7 1 .7 1.6 0 2.8M12 3.6c-.7 1 .7 1.6 0 2.8"/>'),
  unlock: svg('<rect x="5.4" y="10.6" width="13.2" height="9.6" rx="2.2"/><path d="M8.4 10.6V7.8a3.6 3.6 0 0 1 7-1.2"/><path d="M12 14.4v2.2"/>'),
  sparkle: svg('<path d="M12 3.6c.5 4 2.4 6 6.4 6.4-4 .5-5.9 2.4-6.4 6.4-.5-4-2.4-5.9-6.4-6.4 4-.4 5.9-2.4 6.4-6.4z"/><path d="M18.6 15.6c.2 1.5.9 2.2 2.4 2.4-1.5.2-2.2.9-2.4 2.4-.2-1.5-.9-2.2-2.4-2.4 1.5-.2 2.2-.9 2.4-2.4z"/>', { sw: 1.5 }),

  // Tab bar
  home: svg('<path d="M3.8 11.2 12 4.2l8.2 7"/><path d="M5.8 9.6v9.6c0 .6.4 1 1 1h3.6v-5.4c0-.5.4-.9.9-.9h1.4c.5 0 .9.4.9.9v5.4h3.6c.6 0 1-.4 1-1V9.6"/>'),
  stash: svg('<circle cx="9.4" cy="13.2" r="5.6"/><path d="M5.6 9.4c2.4.4 4.6 2.4 5.4 5.4M4.2 13.8c2.2-.4 4.6.6 6 3.2M9.6 7.6c1.6 1.4 2.4 3.6 2 6"/><circle cx="16.8" cy="9" r="4"/><path d="M14 7.4c1.6.2 3 1.4 3.6 3.4M18.6 5.6c.4 1.4 0 2.8-.8 3.8"/><path d="M12.6 18.6c2.4.6 5.2.6 7.6-.4"/>', { sw: 1.6 }),
  projects: svg('<path d="M8.6 4.2 4.4 6.6 2.8 12l2.8 1 .8-2.4v9.2h11.2v-9.2l.8 2.4 2.8-1-1.6-5.4-4.2-2.4"/><path d="M8.6 4.2c.6 1.2 1.9 2 3.4 2s2.8-.8 3.4-2"/><path d="M12 6.4v13.4M9.2 10.4l1.4 1.4M9.2 13.6l1.4 1.4M14.8 10.4l-1.4 1.4M14.8 13.6l-1.4 1.4"/>', { sw: 1.6 }),
  patterns: svg('<path d="M12 6.6c-2-1.6-4.8-2.2-8-1.8v13.6c3.2-.4 6 .2 8 1.8 2-1.6 4.8-2.2 8-1.8V4.8c-3.2-.4-6 .2-8 1.8z"/><path d="M12 6.6v13.6"/>'),
  activity: svg('<path d="M4 20.2h16.4"/><rect x="5.4" y="12" width="3.2" height="6" rx="1"/><rect x="10.4" y="7.4" width="3.2" height="10.6" rx="1"/><rect x="15.4" y="10" width="3.2" height="8" rx="1"/>'),
  counter: svg('<rect x="4" y="4.8" width="16" height="14.6" rx="3"/><path d="M9.2 9.4v5.2M7.8 10.4l1.4-1M13 9.6c.4-.5 1-.8 1.6-.8 1 0 1.6.7 1.6 1.5 0 1.4-3.2 2.4-3.2 4.3h3.4"/>'),

  // Settings & sync
  cloud: svg('<path d="M7.2 18.6h10.2a3.9 3.9 0 0 0 .5-7.8 5.6 5.6 0 0 0-10.8-1.2A4.5 4.5 0 0 0 7.2 18.6z"/>'),
  cloudOff: svg('<path d="M7.2 18.6h10.2a3.9 3.9 0 0 0 .5-7.8 5.6 5.6 0 0 0-10.8-1.2A4.5 4.5 0 0 0 7.2 18.6z"/><path d="M4.4 4.4l15.2 15.2"/>'),
  sync: svg('<path d="M19.2 9.6A7.4 7.4 0 0 0 5.6 8.2"/><path d="M5.2 4.6l.4 3.8 3.7-.5"/><path d="M4.8 14.4a7.4 7.4 0 0 0 13.6 1.4"/><path d="M18.8 19.4l-.4-3.8-3.7.5"/>'),
  mail: svg('<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.6"/><path d="M4.4 7l7 5.4c.4.3.9.3 1.2 0l7-5.4"/>'),
  user: svg('<circle cx="12" cy="8.4" r="3.8"/><path d="M4.8 20c.8-3.8 3.6-5.8 7.2-5.8s6.4 2 7.2 5.8"/>'),
  signOut: svg('<path d="M13.6 4.4H7c-.9 0-1.6.7-1.6 1.6v12c0 .9.7 1.6 1.6 1.6h6.6"/><path d="M10.4 12h10M16.8 8.2l3.8 3.8-3.8 3.8"/>'),
  offline: svg('<path d="M12 20.4V12.8"/><path d="M8.6 17.2 12 20.6l3.4-3.4"/><path d="M5.4 9.4a9.4 9.4 0 0 1 13.2 0"/><path d="M8.2 12.2a5.4 5.4 0 0 1 7.6 0"/>'),
  heart: svg('<path d="M12 19.6s-7.4-4.4-7.4-9.6a4 4 0 0 1 7.4-2.2A4 4 0 0 1 19.4 10c0 5.2-7.4 9.6-7.4 9.6z"/>'),
};

// Brand mark: the user's own Loopy Days logo.
export const yarnMark = (size = 40) =>
  `<img class="yarn-mark" src="./icons/logo-160.png" width="${size}" height="${size}" alt="" aria-hidden="true">`;
