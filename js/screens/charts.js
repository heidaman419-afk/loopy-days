// Charts of a pattern (#/charts/<patternId>[/<page>]).
// Without a page: the list of chart pages found in the PDF (and a search for older patterns).
// With a page: read that page's chart on this device and confirm it: check the grid against the page,
// turn it upright if it is printed sideways, fix uncertain cells, pick each key's stitch and colour,
// say how it is worked and which step it follows. Saving puts it into every guide of the pattern.

import { icons } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { toast } from '../ui/overlay.js';
import { getPattern, savePattern, pdfBlob, guidesOf, applyCharts } from '../data/patterns.js';
import { SYMBOLS, COLOURS, symbolById, symbolSVG, drawSymbol, fromLegendText } from '../patterns/chart-symbols.js';
import { cellFeature, maskDist } from '../patterns/chart-grid.js';
import { chartRows, upright } from '../patterns/chart-rows.js';
import { suggestPlace, placeOf } from '../patterns/chart-guide.js';

export const fullscreen = true;
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
const chartIdOf = (page) => `pg${page}`;

export async function mount(root, params) {
  let pattern = await getPattern(params[0]);
  if (!pattern) { location.hash = '#/patterns'; return; }
  const back = `#/pattern/${pattern.id}`;
  let doc = null; let lib = null; let alive = true;
  const canvases = [];
  async function openDoc() {
    if (doc) return doc;
    const blob = await pdfBlob(pattern);
    if (!blob) return null;
    const pdf = await import('../patterns/pdf.js');
    lib = await pdf.loadPdfLib();
    doc = await pdf.openPdf(blob);
    return doc;
  }
  const cleanup = async () => {
    alive = false;
    const { freeCanvas } = await import('../patterns/chart-read.js');
    canvases.forEach(freeCanvas);
    if (doc) { const { closePdf } = await import('../patterns/pdf.js'); closePdf(doc); doc = null; }
  };

  if (params[1]) await chartScreen(+params[1]); else await listScreen();
  return cleanup;

  /* ---------------- the list ---------------- */

  async function listScreen() {
    const saved = new Map((pattern.charts || []).map((c) => [c.page, c]));
    const hasGuide = (await guidesOf(pattern.id)).some((g) => !g.deleted);
    const pages = [...new Set([...(pattern.chart_pages || []).map((c) => c.page), ...saved.keys()])].sort((a, b) => a - b);
    const found = new Map((pattern.chart_pages || []).map((c) => [c.page, c.grid]));
    root.innerHTML = `
      <header class="soft-head"><a class="icon-btn icon-btn--round" href="${back}" aria-label="Back to the pattern">${icons.back}</a></header>
      <main class="setup ch-list">
        <div class="setup__art">${icons.grid}</div>
        <h1 class="setup__title">Charts in ${esc(pattern.name)}</h1>
        <p class="settings__p">${pages.length ? 'Confirm each chart once: check it against the page and pick the stitches. It then shows up in the guide’s steps.' : pattern.chart_pages ? 'No charts were found in this PDF.' : 'This pattern was added before charts could be found. Look through the PDF now?'}</p>
        <div class="ch-pages">${pages.map((pg) => {
          const c = saved.get(pg);
          const st = c ? (c.status === 'confirmed' ? (hasGuide ? 'Confirmed · in the guide' : 'Confirmed · goes in the guide when you build it') : 'Started, not confirmed') : 'To confirm';
          return `<a class="mini-link" href="#/charts/${pattern.id}/${pg}"><strong>${esc(c ? c.name : `Chart on page ${pg}`)}</strong>
            <span>Page ${pg}${found.get(pg) ? ` · ${esc(found.get(pg))}` : ''} · ${st}</span>${icons.chevronRight}</a>`;
        }).join('')}</div>
        <p class="settings__p ch-status" data-status role="status"></p>
        ${pattern.pdf_file_id ? `<form class="ch-other" data-other><label class="field"><span class="field__label">A chart on another page?</span>
          <span class="ch-row"><input class="input input--small" name="page" inputmode="numeric" pattern="[0-9]*" placeholder="Page number" aria-label="Page number" style="width:140px">
          <button type="submit" class="btn btn--small btn--secondary">Read that page</button></span></label></form>` : ''}
      </main>
      <footer class="setup-actions">
        ${pattern.pdf_file_id ? `<button type="button" class="btn ${pages.length ? 'btn--secondary' : 'btn--butter'} btn--block" data-scan>${icons.grid}<span>${pattern.chart_pages ? 'Look for charts again' : 'Look for charts'}</span></button>` : '<p class="settings__p">Attach the pattern’s PDF first (Edit on the pattern page).</p>'}
        <a class="btn btn--text btn--block" href="${back}">Back to the pattern</a>
      </footer>`;
    root.querySelector('[data-other]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseInt(new FormData(e.currentTarget).get('page'), 10);
      if (n > 0 && (!pattern.pdf_pages || n <= pattern.pdf_pages)) location.hash = `#/charts/${pattern.id}/${n}`;
      else toast(pattern.pdf_pages ? `Pick a page from 1 to ${pattern.pdf_pages}` : 'Type a page number');
    });
    root.querySelector('[data-scan]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const status = root.querySelector('[data-status]');
      try {
        const d = await openDoc();
        if (!d) { status.textContent = 'The PDF isn’t on this device yet. Try when you’re online.'; btn.disabled = false; return; }
        const { quickScan } = await import('../patterns/chart-read.js');
        const out = [];
        for (let p = 1; p <= d.numPages && alive; p++) {
          status.textContent = `Looking for charts… page ${p} of ${d.numPages}`; await nextFrame();
          const page = await d.getPage(p);
          const grid = await quickScan(page, lib);
          page.cleanup();
          if (grid) out.push({ page: p, grid });
        }
        if (!alive) return;
        pattern = await getPattern(pattern.id);
        pattern.chart_pages = out;
        await savePattern(pattern);
        await listScreen();
        toast(out.length ? `${out.length} chart${out.length > 1 ? 's' : ''} found` : 'No charts found in this PDF');
      } catch (err) { console.error(err); status.textContent = 'Couldn’t look through the PDF.'; btn.disabled = false; }
    });
  }

  /* ---------------- one chart ---------------- */

  async function chartScreen(pnum) {
    root.innerHTML = `
      <header class="soft-head"><a class="icon-btn icon-btn--round" href="#/charts/${pattern.id}" aria-label="Back to the charts">${icons.back}</a></header>
      <main class="setup"><div class="setup__art">${icons.grid}</div><h1 class="setup__title">Reading the chart on page ${pnum}…</h1>
        <p class="settings__p">All on your phone. Nothing is uploaded.</p></main>`;
    const d = await openDoc();
    if (!alive) return;
    if (!d) { root.querySelector('.setup__title').textContent = 'The PDF isn’t on this device yet'; return; }
    await nextFrame();
    const { readChart, cellImage } = await import('../patterns/chart-read.js');
    let r;
    try { r = await readChart(d, pnum, lib); } catch (err) { console.error(err); r = null; }
    if (!alive) return;
    if (!r) { root.querySelector('.setup__title').textContent = `No chart grid found on page ${pnum}`; return; }
    canvases.push(r.pageCanvas, r.cellCanvas);
    const guides = (await guidesOf(pattern.id)).filter((g) => !g.deleted && g.tree);
    const tree = guides[0] ? guides[0].tree : { pieces: [] };
    const saved = (pattern.charts || []).find((c) => c.page === pnum);
    const others = (pattern.charts || []).filter((c) => c.page !== pnum);
    const C = buildChart(r, cellImage, saved, others, tree);
    render(C, r, tree);
  }

  function buildChart(r, cellImage, saved, others, tree) {
    const { res, grid: g } = r;
    const C = {
      id: chartIdOf(r.page), page: r.page, name: r.name, status: 'draft', rot: 0, worked: 'round', first_side: 'RS', times: 1,
      place: null, sel: null, grid: { rows: g.rows, cols: g.cols, cells: res.grid.map((row) => row.slice()) },
      original: res.grid.map((row) => row.slice()),
      flagged: new Set(res.cells.filter((c) => c.uncertain).map((c) => `${c.r},${c.c}`)),
      unused: r.unused,
    };
    C.keys = res.classes.map((Cl, id) => {
      const k = { id, name: '', nameFrom: '', none: false, stitch: null, colour: null, fill: Cl.fill.map(Math.round), n: Cl.n,
        img: cellImage(r.cellCanvas, g, Cl.sample.r, Cl.sample.c), mask: Cl.glyphId >= 0 ? Array.from(res.glyphs[Cl.glyphId].mask, (v) => Math.round(v * 100) / 100) : null,
        outside: !!Cl.outside, legend: null };
      if (Cl.outside) return Object.assign(k, { name: 'Not part of the chart', nameFrom: 'reader', stitch: 'none', none: true });
      const L = r.legend.get(id);
      if (L) k.legend = { text: L.text || '', img: L.img, page: L.page, span: L.span || 1 };
      if (L && L.text) {
        const t = fromLegendText(L.text, L.span || 1);
        k.name = L.text; k.nameFrom = 'legend text';
        if (t.symbol) { k.stitch = t.symbol.id; k.none = !!t.symbol.none; }
        if (t.colour != null) k.colour = t.colour;
        if (!t.symbol && t.colour != null && !k.mask) k.stitch = 'k';        // "Main color" on a plain square: knit in it
      }
      if (!k.stitch || k.colour == null) {       // same-looking key already set up in another chart: carry it over
        const twin = others.flatMap((c) => (c.keys || []).map((o) => ({ o, c }))).find(({ o }) => !o.outside && (o.stitch || o.colour != null)
          && rgbDist(o.fill, k.fill) < 30 && !!o.mask === !!k.mask && (!k.mask || (maskDist(Float32Array.from(o.mask), Float32Array.from(k.mask)) + maskDist(Float32Array.from(k.mask), Float32Array.from(o.mask))) / 2 < 0.15));
        if (twin) {
          if (!k.stitch && twin.o.stitch) { k.stitch = twin.o.stitch; k.none = !!twin.o.none; }
          if (k.colour == null && twin.o.colour != null) k.colour = twin.o.colour;
          if (!k.name) { k.name = twin.o.name; k.nameFrom = `copied from “${twin.c.name}”`; }
        }
      }
      return k;
    });
    // A chart confirmed before: its saved grid and choices replace the fresh read (same size only).
    if (saved && saved.grid && saved.grid.rows === g.rows && saved.grid.cols === g.cols) {
      Object.assign(C, { name: saved.name, status: saved.status, rot: saved.rot || 0, worked: saved.worked || 'round', first_side: saved.first_side || 'RS', times: saved.times || 1, place: saved.place || null });
      C.grid.cells = saved.grid.cells.map((row) => row.slice());
      C.flagged = new Set(saved.flagged || []);
      // The saved keys as they were (swatch, look, choices), so a changed reader can't move a name onto
      // another swatch; only the legend picture comes from this read when that key's id still matches.
      if (saved.keys) C.keys = saved.keys.map((sk) => {
        const fresh = C.keys.find((x) => x.id === sk.id);
        const legend = sk.legend ? { ...sk.legend, img: fresh && fresh.legend && fresh.legend.page === sk.legend.page ? fresh.legend.img : '' } : null;
        return { ...sk, nameFrom: sk.nameFrom || 'typed', none: !!sk.none, legend: legend && legend.img ? legend : (legend ? { ...legend, img: '' } : null) };
      });
      C.original = C.grid.cells.map((row) => row.slice());
    } else {
      const p = suggestPlace(tree, C);
      C.place = p;
    }
    return C;
  }

  function render(C, r, tree) {
    const steps = [];
    for (const piece of tree.pieces || []) for (const section of piece.sections || []) for (const b of section.blocks || []) {
      if (!b.chart_id) steps.push({ label: `${piece.name}${section.name !== piece.name ? ` › ${section.name}` : ''} › ${b.title || b.kind}`, place: placeOf(b) });
    }
    const placeIndex = () => (C.place ? steps.findIndex((s) => s.place.title === C.place.title && s.place.text === C.place.text) : -1);
    let zoom = 0;

    root.innerHTML = `
      <header class="soft-head ch-head">
        <a class="icon-btn icon-btn--round" href="#/charts/${pattern.id}" aria-label="Back to the charts">${icons.back}</a>
        <input class="input ch-name" data-name value="${esc(C.name)}" aria-label="Chart name">
      </header>
      <main class="ch">
        <p class="ch-size" data-size></p>
        <div class="ch-bar">
          <button type="button" class="btn btn--small btn--secondary" data-rot="-1" aria-label="Turn anticlockwise">⟲ Turn</button>
          <button type="button" class="btn btn--small btn--secondary" data-rot="1" aria-label="Turn clockwise">Turn ⟳</button>
          <button type="button" class="btn btn--small btn--secondary" data-walk="1">Next to check <span class="count-chip" data-unc></span></button>
        </div>
        <div class="ch-grid-wrap"><div class="ch-grid" data-grid></div></div>
        <p class="settings__p ch-hint">As knitted: row 1 at the bottom, stitch 1 on the right. Hatched squares are background, not stitches. Tap a square to check it against the page.</p>

        <details class="ch-card" data-source-card>
          <summary>${icons.file}<span>The page</span></summary>
          <div class="ch-zoom"><button type="button" class="btn btn--small btn--secondary" data-zoom="chart">Chart</button><button type="button" class="btn btn--small btn--secondary" data-zoom="page">Whole page</button>
            <button type="button" class="btn btn--small btn--secondary" data-zoom="out" aria-label="Zoom out">−</button><button type="button" class="btn btn--small btn--secondary" data-zoom="in" aria-label="Zoom in">+</button></div>
          <div class="ch-src" data-src><div class="ch-src__wrap" data-src-wrap><div class="ch-lattice" data-lattice></div><div class="ch-hilite" data-hilite hidden></div></div></div>
        </details>

        <section class="ch-card" data-cell hidden></section>

        <section class="ch-card">
          <h2 class="sec-title">${icons.list}<span>Keys</span></h2>
          <p class="settings__p">Pick the stitch and colour for each. The legend line from the PDF is shown where it was found.</p>
          <div data-keys></div>
        </section>

        <section class="ch-card">
          <h2 class="sec-title">${icons.repeat}<span>How it’s worked</span></h2>
          <div class="chips" data-worked>
            <button type="button" class="chip" data-w="round">In the round</button><button type="button" class="chip" data-w="flat">Back and forth</button>
          </div>
          <div class="chips" data-side-row><span class="settings__p">Row 1 is</span><button type="button" class="chip" data-side="RS">Right side</button><button type="button" class="chip" data-side="WS">Wrong side</button></div>
          <label class="field"><span class="field__label">Times the whole chart is worked</span><input class="input" data-times inputmode="numeric" pattern="[0-9]*" value="${C.times}"></label>
          <label class="field"><span class="field__label">In the guide, it comes after</span>
            <select class="input" data-place><option value="-1">Its own “Charts” section</option>${steps.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('')}</select></label>
          <p class="settings__p" data-place-note></p>
        </section>

        <section class="ch-card"><h2 class="sec-title">${icons.check}<span>Checks</span></h2><div data-checks class="ch-checks"></div></section>
      </main>
      <footer class="knit-bar"><button type="button" class="knit-bar__go" data-save><span class="knit-bar__label">${icons.check}<span>Save chart to the guide</span></span>
        <span class="knit-bar__sub" data-save-sub></span></button></footer>
      <div class="lib" data-lib hidden role="dialog" aria-modal="true" aria-labelledby="ch-lib-title"><div class="lib-panel">
        <div class="lib-head"><h3 id="ch-lib-title" data-lib-title>Pick the stitch</h3><button type="button" class="btn btn--small btn--secondary" data-lib-close>Close</button></div>
        <div class="lib-key" data-lib-key></div>
        <input type="search" class="input" data-lib-search placeholder="Search: yarn over, k2tog, purl…" aria-label="Search stitches">
        <div class="lib-list" data-lib-list></div></div></div>`;
    const $ = (s) => root.querySelector(s);
    root.querySelector('[data-place]').value = String(placeIndex());

    // ----- orientation helpers -----
    const U = () => upright({ rot: C.rot, grid: C.grid });
    const keyOf = (id) => C.keys.find((k) => k.id === id);
    const cellV = (vr, vc) => U().at(vr, vc);
    const keyName = (k) => { const n = (k.name || '').trim() || `Key ${C.keys.indexOf(k) + 1}`; return n + ((k.none || k.stitch === 'none') && !/no stitch|not part/i.test(n) ? ' (no stitch)' : ''); };

    // ----- grid -----
    function renderGrid() {
      const u = U(), g = r.grid, box = $('[data-grid]');
      const pw = C.rot % 2 ? g.pitch[1] : g.pitch[0], ph = C.rot % 2 ? g.pitch[0] : g.pitch[1];
      const avail = Math.max(200, root.clientWidth - 64);
      const cw = Math.max(12, Math.min(34, Math.floor(avail / u.cols)));
      const ch = Math.max(10, Math.round(cw * ph / pw));
      box.style.gridTemplateColumns = `repeat(${u.cols}, ${cw}px) 26px`;
      box.style.gridAutoRows = `${ch}px`;
      let html = '';
      for (let vr = 0; vr < u.rows; vr++) {
        for (let vc = 0; vc < u.cols; vc++) html += `<button type="button" class="ch-cell" data-r="${vr}" data-c="${vc}" aria-label="Row ${u.rows - vr}, stitch ${u.cols - vc}"></button>`;
        html += `<span class="ch-num">${u.rows - vr}</span>`;
      }
      for (let vc = 0; vc < u.cols; vc++) html += `<span class="ch-num">${u.cols - vc}</span>`;
      box.innerHTML = html;
      $('[data-size]').textContent = `${u.cols} stitches × ${u.rows} rows${C.rot ? ` · turned ${['', 'a quarter turn clockwise', 'upside down', 'a quarter turn anticlockwise'][C.rot]}` : ''}`;
      paintCells();
    }
    function paintCells() {
      const u = U();
      for (const el of root.querySelectorAll('.ch-cell')) {
        const vr = +el.dataset.r, vc = +el.dataset.c, [pr, pc] = u.toPrinted(vr, vc), k = keyOf(C.grid.cells[pr][pc]);
        el.style.backgroundImage = k.outside ? '' : `url(${k.img})`;
        el.classList.toggle('is-outside', k.outside);
        el.classList.toggle('is-flag', C.flagged.has(`${pr},${pc}`));
        el.classList.toggle('is-changed', C.grid.cells[pr][pc] !== C.original[pr][pc]);
        el.classList.toggle('is-sel', !!C.sel && C.sel[0] === pr && C.sel[1] === pc);
      }
      $('[data-unc]').textContent = String(C.flagged.size);
    }
    function select(pr, pc, openSource) {
      C.sel = [pr, pc]; paintCells(); renderCell(); showHilite(openSource);
    }
    $('[data-grid]').addEventListener('click', (e) => {
      const el = e.target.closest('.ch-cell'); if (!el) return;
      const [pr, pc] = U().toPrinted(+el.dataset.r, +el.dataset.c); select(pr, pc, false);
    });
    root.querySelector('[data-walk]').addEventListener('click', () => {
      const u = U();
      const list = [...C.flagged].map((s) => s.split(',').map(Number)).map(([pr, pc]) => ({ pr, pc, v: u.toUpright(pr, pc) })).sort((a, b) => (b.v[0] - a.v[0]) || (b.v[1] - a.v[1]));
      if (!list.length) { toast('Nothing left to check'); return; }
      const cur = C.sel ? list.findIndex((x) => x.pr === C.sel[0] && x.pc === C.sel[1]) : -1;
      const n = list[(cur + 1) % list.length];
      select(n.pr, n.pc, true);
      root.querySelector(`.ch-cell[data-r="${n.v[0]}"][data-c="${n.v[1]}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    // ----- selected cell -----
    function renderCell() {
      const box = $('[data-cell]');
      if (!C.sel) { box.hidden = true; return; }
      const [pr, pc] = C.sel, u = U(), [vr, vc] = u.toUpright(pr, pc), cur = C.grid.cells[pr][pc], flagged = C.flagged.has(`${pr},${pc}`);
      box.hidden = false;
      box.innerHTML = `<h2 class="sec-title">${icons.grid}<span>Row ${u.rows - vr}, stitch ${u.cols - vc}</span></h2>
        <p class="settings__p"><b>${esc(keyName(keyOf(cur)))}</b>${flagged ? ' · <span class="ch-warn">not sure, please check</span>' : ''}${cur !== C.original[pr][pc] ? ' · changed' : ''}</p>
        <div class="ch-pick">${C.keys.map((k) => `<button type="button" data-key="${k.id}" class="${k.id === cur ? 'is-on' : ''}"><span class="ch-swatch ${k.outside ? 'is-outside' : ''}" style="${k.outside ? '' : `background-image:url(${k.img})`}"></span>${esc(keyName(k))}</button>`).join('')}</div>
        ${flagged ? '<button type="button" class="btn btn--small btn--secondary" data-ok>Looks right</button>' : ''}`;
    }
    $('[data-cell]').addEventListener('click', (e) => {
      if (!C.sel) return;
      const [pr, pc] = C.sel;
      const b = e.target.closest('[data-key]');
      if (b) { C.grid.cells[pr][pc] = +b.dataset.key; C.flagged.delete(`${pr},${pc}`); paintCells(); renderCell(); renderKeys(); renderChecks(); }
      if (e.target.closest('[data-ok]')) { C.flagged.delete(`${pr},${pc}`); paintCells(); renderCell(); renderChecks(); }
    });

    // ----- source page -----
    const src = r.pageCanvas;
    src.className = 'ch-src__canvas';
    $('[data-src-wrap]').prepend(src);
    function applyZoom() {
      const wrap = $('[data-src-wrap]'), gp = r.gridPage;
      src.style.width = `${src.width * zoom}px`; src.style.height = `${src.height * zoom}px`;
      wrap.style.width = src.style.width; wrap.style.height = src.style.height;
      Object.assign($('[data-lattice]').style, { left: `${gp.xs[0] * zoom - 2}px`, top: `${gp.ys[0] * zoom - 2}px`, width: `${(gp.xs[gp.cols] - gp.xs[0]) * zoom + 4}px`, height: `${(gp.ys[gp.rows] - gp.ys[0]) * zoom + 4}px` });
      showHilite(false);
    }
    function zoomTo(mode) {
      const sc = $('[data-src]'), gp = r.gridPage, w = gp.xs[gp.cols] - gp.xs[0];
      if (mode === 'page' || !zoom) zoom = (sc.clientWidth || 320) / src.width;
      if (mode === 'chart') zoom = Math.min(1, ((sc.clientWidth || 320) - 16) / w);
      if (mode === 'in') zoom = Math.min(2, zoom * 1.25);
      if (mode === 'out') zoom = Math.max(0.08, zoom / 1.25);
      applyZoom();
      if (mode === 'chart') { sc.scrollLeft = gp.xs[0] * zoom - 8; sc.scrollTop = gp.ys[0] * zoom - 8; }
    }
    function showHilite(open) {
      const h = $('[data-hilite]');
      if (!C.sel || !zoom) { h.hidden = true; if (open && C.sel) { $('[data-source-card]').open = true; zoomTo('chart'); showHilite(false); } return; }
      const [pr, pc] = C.sel, gp = r.gridPage;
      h.hidden = false;
      Object.assign(h.style, { left: `${gp.xs[pc] * zoom - 3}px`, top: `${gp.ys[pr] * zoom - 3}px`, width: `${(gp.xs[pc + 1] - gp.xs[pc]) * zoom + 6}px`, height: `${(gp.ys[pr + 1] - gp.ys[pr]) * zoom + 6}px` });
      if (open) { $('[data-source-card]').open = true; h.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    }
    $('[data-source-card]').addEventListener('toggle', (e) => { if (e.target.open && !zoom) zoomTo('chart'); });
    root.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => zoomTo(b.dataset.zoom)));
    $('[data-src-wrap]').addEventListener('click', (e) => {
      const rect = src.getBoundingClientRect(), gp = r.gridPage;
      const x = (e.clientX - rect.left) / zoom, y = (e.clientY - rect.top) / zoom;
      const pc = gp.xs.findIndex((v, i) => i < gp.cols && x >= v && x < gp.xs[i + 1]);
      const pr = gp.ys.findIndex((v, i) => i < gp.rows && y >= v && y < gp.ys[i + 1]);
      if (pr >= 0 && pc >= 0) select(pr, pc, false);
    });

    // ----- keys + stitch library -----
    let LIB = null;
    const library = () => LIB || (LIB = SYMBOLS.filter((s) => s.glyph && !s.glyph.grey && Object.keys(s.glyph).length && !s.span).map((sym) => {
      const px = 130, cv = document.createElement('canvas'); cv.width = cv.height = px;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px); ctx.translate(15, 15); drawSymbol(ctx, sym, 100);
      return { sym, mask: cellFeature(ctx.getImageData(0, 0, px, px), 0, px, 0, px).mask };
    }));
    function suggestions(k) {
      const out = [];
      if (k.legend && k.legend.text) { const t = fromLegendText(k.legend.text, k.legend.span); if (t.symbol) out.push(t.symbol); }
      if (k.mask) {
        const m = Float32Array.from(k.mask);
        library().map((e) => ({ sym: e.sym, d: (maskDist(m, e.mask) + maskDist(e.mask, m)) / 2 })).sort((a, b) => a.d - b.d).filter((e) => e.d < 0.3).slice(0, 3).forEach((e) => out.push(e.sym));
      } else out.push(symbolById('k'), symbolById('none'));
      return out.filter((s, i) => out.indexOf(s) === i).slice(0, 3);
    }
    function composeName(k) {
      const sym = k.stitch ? symbolById(k.stitch) : null, col = k.colour != null ? COLOURS[k.colour] : '';
      if (!sym) return col;
      if (sym.id === 'k' && col) return col;
      if (sym.none) return sym.name;
      return col ? `${sym.name}, ${col.toLowerCase()}` : sym.name;
    }
    const refreshName = (k) => { if (k.nameFrom !== 'typed' && k.nameFrom !== 'legend text' && !k.outside) { k.name = composeName(k); k.nameFrom = k.name ? 'picked' : ''; } };
    function pickStitch(k, symId) {
      const sym = symbolById(symId); if (!sym) return;
      k.stitch = sym.id; k.none = !!sym.none;
      if (k.nameFrom === 'legend text' && (fromLegendText(k.legend && k.legend.text, k.legend && k.legend.span).symbol || {}).id !== sym.id) k.nameFrom = 'picked';
      refreshName(k); renderKeys(); paintCells(); renderCell(); renderChecks();
    }
    function setColour(k, idx) {
      k.colour = idx; refreshName(k);
      for (const o of C.keys) if (o !== k && !o.outside && o.colour == null && !o.none && o.stitch !== 'none' && rgbDist(o.fill, k.fill) < 30) { o.colour = idx; refreshName(o); }
      renderKeys(); renderCell(); renderChecks();
    }
    function renderKeys() {
      const count = (id) => C.grid.cells.reduce((t, row) => t + row.filter((x) => x === id).length, 0);
      const list = [...C.keys.filter((k) => !k.outside), ...C.keys.filter((k) => k.outside)];
      $('[data-keys]').innerHTML = list.map((k) => {
        const i = C.keys.indexOf(k);
        if (k.outside) return `<div class="ch-key" data-k="${k.id}"><span class="ch-swatch is-outside"></span><div><b>Not part of the chart</b>
          <p class="settings__p">${count(k.id)} background squares with faint outlines: the page’s grid, not stitches.</p>
          <select class="input input--small" data-merge aria-label="These are stitches: merge into a key"><option value="">These are stitches after all: merge into…</option>${C.keys.filter((o) => o !== k).map((o) => `<option value="${o.id}">${esc(keyName(o))}</option>`).join('')}</select></div></div>`;
        const sym = k.stitch ? symbolById(k.stitch) : null;
        const sugg = suggestions(k).filter((x) => x.id !== k.stitch);
        return `<div class="ch-key" data-k="${k.id}"><span class="ch-swatch" style="background-image:url(${k.img})"></span><div>
          ${k.legend ? `${k.legend.img ? `<img class="ch-legend" src="${k.legend.img}" alt="Legend line${k.legend.text ? `: ${esc(k.legend.text)}` : ''}">` : `<span class="settings__p">Legend: ${esc(k.legend.text || 'matched')}</span>`}${k.legend.page !== C.page ? `<span class="settings__p">Legend on page ${k.legend.page}</span>` : ''}` : '<p class="settings__p">No legend line matched.</p>'}
          <div class="ch-row">
            <button type="button" class="btn btn--small btn--secondary ch-stitch" data-lib-open aria-label="Pick the stitch for key ${i + 1}">${sym ? `${symbolSVG(sym, 20)} ${esc(sym.name)}` : 'Pick stitch…'}</button>
            ${sugg.map((x) => `<button type="button" class="chip ch-sugg" data-sugg="${x.id}">${symbolSVG(x, 16)} ${esc(x.name)}</button>`).join('')}
          </div>
          <div class="ch-row"><select class="input input--small" data-colour aria-label="Colour for key ${i + 1}"><option value="">No colour</option>${COLOURS.map((c, j) => `<option value="${j}" ${k.colour === j ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <span class="ch-fill" style="background:rgb(${k.fill.join(',')})"></span><span class="settings__p">${count(k.id)} squares</span></div>
          <input class="input" data-kname value="${esc(k.name)}" placeholder="Name (filled in when you pick)" aria-label="Name for key ${i + 1}">
          ${k.nameFrom === 'legend text' ? '<span class="settings__p">From the legend text.</span>' : /^copied/.test(k.nameFrom) ? `<span class="settings__p">Picks ${esc(k.nameFrom)}.</span>` : ''}
          ${C.keys.length > 1 ? `<select class="input input--small" data-merge aria-label="Merge key ${i + 1}"><option value="">Same as another key? Merge into…</option>${C.keys.filter((o) => o !== k).map((o) => `<option value="${o.id}">${esc(keyName(o))}</option>`).join('')}</select>` : ''}
        </div></div>`;
      }).join('');
    }
    $('[data-keys]').addEventListener('click', (e) => {
      const k = keyOf(+e.target.closest('[data-k]')?.dataset.k); if (!k) return;
      const sg = e.target.closest('[data-sugg]'); if (sg) pickStitch(k, sg.dataset.sugg);
      if (e.target.closest('[data-lib-open]')) openLibrary(k);
    });
    $('[data-keys]').addEventListener('input', (e) => {
      const k = keyOf(+e.target.closest('[data-k]')?.dataset.k); if (!k || !e.target.matches('[data-kname]')) return;
      k.name = e.target.value; k.nameFrom = k.name.trim() ? 'typed' : ''; renderChecks();
    });
    $('[data-keys]').addEventListener('change', (e) => {
      const k = keyOf(+e.target.closest('[data-k]')?.dataset.k); if (!k) return;
      if (e.target.matches('[data-colour]')) setColour(k, e.target.value === '' ? null : +e.target.value);
      if (e.target.matches('[data-merge]') && e.target.value !== '') {
        const into = +e.target.value;
        C.grid.cells = C.grid.cells.map((row) => row.map((x) => (x === k.id ? into : x)));
        C.original = C.original.map((row) => row.map((x) => (x === k.id ? into : x)));
        C.keys = C.keys.filter((x) => x !== k);
        renderKeys(); paintCells(); renderCell(); renderChecks();
      }
    });
    function openLibrary(k) {
      const dlg = $('[data-lib]');
      dlg.dataset.key = String(k.id);
      $('[data-lib-title]').textContent = `Pick the stitch for key ${C.keys.indexOf(k) + 1}`;
      $('[data-lib-key]').innerHTML = `<span class="ch-swatch" style="background-image:url(${k.img})"></span>${k.legend && k.legend.img ? `<img class="ch-legend" src="${k.legend.img}" alt="">` : ''}`;
      $('[data-lib-search]').value = '';
      renderLibrary('');
      dlg.hidden = false;
    }
    function renderLibrary(q) {
      const k = keyOf(+$('[data-lib]').dataset.key), t = q.trim().toLowerCase();
      const match = (s) => !t || s.name.toLowerCase().includes(t) || s.abbr.toLowerCase().includes(t) || s.aliases.some((a) => a.includes(t));
      const btn = (s) => {
        const net = s.span ? s.span * (s.makes - s.uses) : s.makes - s.uses;
        return `<button type="button" class="lib-item ${k.stitch === s.id ? 'is-on' : ''}" data-sym="${s.id}">${symbolSVG(s, 34)}<span>${esc(s.name)}</span><small>${esc(s.abbr)}${s.none ? '' : net ? ` · ${net > 0 ? '+' : '−'}${Math.abs(net)}` : ''}${s.span ? ` · ${s.span} squares` : ''}</small></button>`;
      };
      const sugg = suggestions(k);
      $('[data-lib-list]').innerHTML = (!t && sugg.length ? `<h4>Suggested</h4><div class="lib-grid">${sugg.map(btn).join('')}</div>` : '')
        + [...new Set(SYMBOLS.map((s) => s.group))].map((gname) => { const items = SYMBOLS.filter((s) => s.group === gname && match(s)); return items.length ? `<h4>${gname}</h4><div class="lib-grid">${items.map(btn).join('')}</div>` : ''; }).join('')
        + (t && !SYMBOLS.some(match) ? '<p class="settings__p">No stitch matches. Close this and type the name.</p>' : '');
    }
    $('[data-lib-search]').addEventListener('input', (e) => renderLibrary(e.target.value));
    $('[data-lib-list]').addEventListener('click', (e) => { const b = e.target.closest('[data-sym]'); if (!b) return; pickStitch(keyOf(+$('[data-lib]').dataset.key), b.dataset.sym); $('[data-lib]').hidden = true; });
    $('[data-lib-close]').addEventListener('click', () => { $('[data-lib]').hidden = true; });

    // ----- how it's worked, place -----
    function renderWorked() {
      root.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('is-on', b.dataset.w === C.worked));
      root.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('is-on', b.dataset.side === C.first_side));
      $('[data-side-row]').hidden = C.worked !== 'flat';
      const i = placeIndex();
      $('[data-place-note]').textContent = i < 0 ? (C.place ? 'The step it followed can’t be found any more, so it goes in a “Charts” section.' : 'No step mentions this chart. Pick one, or leave it in its own section; you can move it in the guide editor.') : '';
    }
    $('[data-worked]').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) { C.worked = b.dataset.w; renderWorked(); renderChecks(); } });
    $('[data-side-row]').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { C.first_side = b.dataset.side; renderWorked(); renderChecks(); } });
    $('[data-times]').addEventListener('input', (e) => { C.times = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); renderChecks(); });
    $('[data-place]').addEventListener('change', (e) => { const i = +e.target.value; C.place = i >= 0 ? steps[i].place : null; renderWorked(); });
    $('[data-name]').addEventListener('input', (e) => { C.name = e.target.value; });
    root.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => { C.rot = (C.rot + (+b.dataset.rot > 0 ? 1 : 3)) % 4; renderGrid(); renderChecks(); }));

    // ----- checks -----
    const asChart = (rot = C.rot) => ({ rot, worked: C.worked, first_side: C.first_side, grid: C.grid, keys: C.keys });
    function balanceOf(rot) {
      if (C.keys.some((k) => !k.none && !k.outside && !k.stitch)) return null;
      const rows = chartRows(asChart(rot)), bad = [];
      for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].uses - rows[i - 1].makes) > 0.01) bad.push({ row: rows[i].n, uses: rows[i].uses, below: rows[i - 1].makes });
      return { bad, rows: rows.length - 1 };
    }
    function renderChecks() {
      const rows = chartRows(asChart()), bal = balanceOf(C.rot);
      const keys = C.keys.filter((k) => !k.outside), named = keys.filter((k) => (k.name || '').trim() || k.stitch).length;
      let turn = null;
      if (bal && bal.bad.length) for (let k = 0; k < 4; k++) { if (k === C.rot) continue; const b = balanceOf(k); if (b && b.bad.length < bal.bad.length / 3 && (!turn || b.bad.length < turn.bad)) turn = { rot: k, bad: b.bad.length }; }
      const num = (v) => String(v);
      const changes = [];
      for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].makes - rows[i - 1].makes) > 0.01) changes.push(`row ${rows[i].n} (${rows[i].makes > rows[i - 1].makes ? '+' : ''}${num(Math.round((rows[i].makes - rows[i - 1].makes) * 10) / 10)})`);
      $('[data-checks]').innerHTML = `
        ${turn ? `<p class="ch-warn">Turned ${['', 'a quarter turn clockwise', 'upside down', 'a quarter turn anticlockwise'][(turn.rot - C.rot + 4) % 4]} from here, ${turn.bad ? `only ${turn.bad} row${turn.bad > 1 ? 's don’t' : ' doesn’t'} add up` : 'every row adds up'}. The chart is probably printed turned. <button type="button" class="btn btn--small btn--secondary" data-turn="${turn.rot}">Turn it</button></p>` : ''}
        <p>Stitches: <b>${num(rows[0] ? rows[0].makes : 0)}</b> after row 1, <b>${num(rows.length ? rows[rows.length - 1].makes : 0)}</b> after row ${rows.length} (per repeat, before multiplying by repeats).</p>
        <p>Count changes: ${changes.length ? changes.slice(0, 10).join(', ') + (changes.length > 10 ? '…' : '') : 'none'}.</p>
        <p class="${!bal ? '' : bal.bad.length ? 'ch-warn' : 'ch-ok'}">${!bal ? 'Pick a stitch for every key to check that each row uses the stitches the row below left.' : bal.bad.length ? `${bal.bad.length} row${bal.bad.length > 1 ? 's don’t' : ' doesn’t'} add up: ${bal.bad.slice(0, 4).map((b) => `row ${b.row} uses ${b.uses}, the row below left ${b.below}`).join('; ')}. Check those rows.` : `Every row adds up with the row below.`}</p>
        <p class="${named === keys.length ? 'ch-ok' : 'ch-warn'}">${named} of ${keys.length} keys set.</p>
        <p class="${C.flagged.size ? 'ch-warn' : 'ch-ok'}">${C.flagged.size ? `${C.flagged.size} square${C.flagged.size > 1 ? 's' : ''} to check.` : 'No squares left to check.'}</p>
        ${rows[0] ? `<p class="settings__p">Row 1 in words: ${esc(rows[0].text || '(no stitches)')}</p>` : ''}`;
      $('[data-save-sub]').textContent = C.status === 'confirmed' ? 'Saved before · saving again updates the guide' : `${esc(pattern.name)} · page ${C.page}`;
    }
    $('[data-checks]').addEventListener('click', (e) => { const b = e.target.closest('[data-turn]'); if (b) { C.rot = +b.dataset.turn; renderGrid(); renderChecks(); } });

    // ----- save -----
    $('[data-save]').addEventListener('click', async () => {
      const btn = $('[data-save]'); btn.disabled = true;
      try {
        const rec = {
          id: C.id, page: C.page, name: (C.name || '').trim() || `Chart, page ${C.page}`, status: 'confirmed', rot: C.rot, worked: C.worked, first_side: C.first_side,
          times: C.times, place: C.place, grid: { rows: C.grid.rows, cols: C.grid.cols, cells: C.grid.cells.map((row) => row.slice()) },
          keys: C.keys.map((k) => ({ id: k.id, name: (k.name || '').trim(), nameFrom: k.nameFrom, stitch: k.stitch, colour: k.colour, none: !!(k.none || k.stitch === 'none'), outside: k.outside, fill: k.fill, img: k.img, mask: k.mask, legend: k.legend ? { text: k.legend.text, page: k.legend.page, span: k.legend.span } : null })),
          flagged: [...C.flagged], pitch: r.grid.pitch.map((v) => Math.round(v * 10) / 10), confirmed_at: new Date().toISOString(),
        };
        pattern = await getPattern(pattern.id);
        pattern.charts = [...(pattern.charts || []).filter((c) => c.page !== C.page), rec].sort((a, b) => a.page - b.page);
        await savePattern(pattern);
        await applyCharts(pattern, rec.id);
        const hasGuide = (await guidesOf(pattern.id)).some((g) => !g.deleted);
        toast(hasGuide ? `“${rec.name}” is in the guide` : `“${rec.name}” saved. It will be in the guide when you build one.`, { ms: 3500 });
        location.hash = `#/charts/${pattern.id}`;
      } catch (err) { console.error(err); btn.disabled = false; toast('Couldn’t save the chart.'); }
    });

    renderGrid(); renderKeys(); renderWorked(); renderChecks(); renderCell();
  }
}
