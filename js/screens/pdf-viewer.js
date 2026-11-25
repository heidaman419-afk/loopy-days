// PDF viewer (#/pdf/<patternId>[/<page>]) and the same viewer as an overlay (for a PDF not
// saved yet). Pages are drawn with pdf.js only when they come into view, sharp on this
// screen but capped in memory. Pinch zoom works; double-tap a page to zoom it in or out.

import { el, esc } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { getPattern, pdfBlob } from '../data/patterns.js';

export const fullscreen = true;

const closeDoc = (d) => { import('../patterns/pdf.js').then((m) => m.closePdf(d)); };

export async function mount(root, params) {
  const pattern = await getPattern(params[0]);
  const page = Math.max(1, parseInt(params[1], 10) || 1);
  const back = () => { if (history.length > 1) history.back(); else location.hash = pattern ? `#/pattern/${pattern.id}` : '#/patterns'; };
  root.innerHTML = '<div class="pdfv-host"></div>';
  if (!pattern) { location.hash = '#/patterns'; return; }
  const v = viewer(root.firstElementChild, { title: pattern.name, page, onClose: back });
  const blob = await pdfBlob(pattern);
  if (!blob) { v.fail('This PDF hasn’t arrived on this device yet. Connect to the internet once and it will be kept here.'); return v.close; }
  v.load(blob);
  return v.close;
}

/** Overlay version: openPdfOverlay({ blob, title, page }). */
export function openPdfOverlay({ blob, title, page = 1 }) {
  const host = el('<div class="pdfv-overlay"></div>');
  document.body.appendChild(host);
  const v = viewer(host, { title, page, onClose: () => { v.close(); host.remove(); } });
  v.load(blob);
}

function viewer(host, { title, page = 1, onClose }) {
  host.innerHTML = `
    <div class="pdfv">
      <header class="pdfv__top">
        <button type="button" class="icon-btn icon-btn--round" data-close aria-label="Close">${icons.close}</button>
        <span class="pdfv__title">${esc(title || 'Pattern')}</span>
        <span class="pdfv__page" data-indicator>Opening…</span>
      </header>
      <div class="pdfv__pages" data-pages></div>
    </div>`;
  const pagesEl = host.querySelector('[data-pages]');
  const ind = host.querySelector('[data-indicator]');
  host.querySelector('[data-close]').addEventListener('click', () => onClose());
  let doc = null;
  let closed = false;
  let io = null;
  const zoom = new Set();

  async function draw(wrap) {
    if (!doc || closed || wrap.dataset.drawn === '1') return;
    wrap.dataset.drawn = '1';
    const { renderPage } = await import('../patterns/pdf.js');
    const n = +wrap.dataset.page;
    const width = Math.min(pagesEl.clientWidth - 16, 1100) * (zoom.has(n) ? 2 : 1);
    try {
      const c = await renderPage(doc, n, width, wrap.querySelector('canvas') || document.createElement('canvas'));
      if (!c.parentNode) wrap.appendChild(c);
      wrap.style.minHeight = '';
      wrap.classList.add('is-drawn');
    } catch (e) { console.error(e); wrap.dataset.drawn = '0'; }
  }

  async function load(blob) {
    try {
      const { openPdf } = await import('../patterns/pdf.js');
      doc = await openPdf(blob);
      if (closed) { closeDoc(doc); return; }
      const first = await doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      const w = Math.min(pagesEl.clientWidth - 16, 1100);
      for (let n = 1; n <= doc.numPages; n++) {
        const wrap = el(`<div class="pdfv__pagewrap" data-page="${n}" style="min-height:${Math.round((vp.height / vp.width) * w)}px" aria-label="Page ${n}"></div>`);
        pagesEl.appendChild(wrap);
      }
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (en.isIntersecting) draw(en.target);
        }
        const vis = entries.filter((x) => x.isIntersecting).map((x) => +x.target.dataset.page);
        if (vis.length) ind.textContent = `Page ${Math.min(...vis)} of ${doc.numPages}`;
      }, { root: pagesEl, rootMargin: '300px 0px' });
      pagesEl.querySelectorAll('.pdfv__pagewrap').forEach((w2) => io.observe(w2));
      // Keep the indicator right while scrolling.
      pagesEl.addEventListener('scroll', () => {
        const mid = pagesEl.scrollTop + pagesEl.clientHeight / 3;
        let cur = 1;
        for (const w2 of pagesEl.children) if (w2.offsetTop <= mid) cur = +w2.dataset.page;
        ind.textContent = `Page ${cur} of ${doc.numPages}`;
      }, { passive: true });
      ind.textContent = `Page ${Math.min(page, doc.numPages)} of ${doc.numPages}`;
      const target = pagesEl.querySelector(`[data-page="${Math.min(page, doc.numPages)}"]`);
      if (target && page > 1) pagesEl.scrollTop = target.offsetTop - 8;
      // Double-tap / double-click a page to zoom it (re-drawn sharp at the new size).
      let lastTap = 0;
      pagesEl.addEventListener('click', (e) => {
        const wrap = e.target.closest('.pdfv__pagewrap');
        if (!wrap) return;
        const now = Date.now();
        if (now - lastTap < 320 || e.detail === 2) {
          const n = +wrap.dataset.page;
          if (zoom.has(n)) zoom.delete(n); else zoom.add(n);
          wrap.classList.toggle('is-zoomed', zoom.has(n));
          wrap.dataset.drawn = '0';
          draw(wrap);
          lastTap = 0;
        } else lastTap = now;
      });
    } catch (e) {
      console.error(e);
      fail('This PDF couldn’t be opened.');
    }
  }

  function fail(msg) {
    ind.textContent = '';
    pagesEl.innerHTML = `<p class="pdfv__msg">${esc(msg)}</p>`;
  }

  function close() {
    closed = true;
    if (io) io.disconnect();
    if (doc) { closeDoc(doc); doc = null; }
  }

  return { load, fail, close };
}
