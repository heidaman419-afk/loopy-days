// Read a chart from a PDF page on this device (browser; pdf.js canvas). No network, no OCR.
//
// The page is analysed as rendered (what the knitter sees), never from raw images: a PDF can hold
// hidden or clipped copies. Rules: render at ~2400 px on the long side; find the cell lattice; if a
// cell is under 40 px, render ONLY the chart's area again at a higher scale (phones cap canvas size,
// so the whole page is never rendered huge). Legend lines are looked for on the chart's page, then on
// the PDF's other pages, at the page scale.

import { findGrid, readCells } from './chart-grid.js';
import { readLegend } from './chart-legend.js';
import { textBoxes, legendText } from './chart-legend-text.js';

const MAX_PIXELS = 12e6;   // the app's canvas cap (iPhone Safari allows ~16.7 MP)
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/** Scale for ~`longSide` px on the page's long side, kept under the pixel cap. */
export function workScale(page, longSide = 2400) {
  const b = page.getViewport({ scale: 1 });
  let s = Math.round((longSide / Math.max(b.width, b.height)) * 2) / 2;
  while (s > 0.5 && b.width * b.height * s * s > MAX_PIXELS) s -= 0.5;
  return s;
}

/** Render a page (or the area `clip` = {x, y, w, h} in scale-1 page units) at `scale`, white background. */
export async function renderPage(page, scale, clip = null) {
  const vp = page.getViewport(clip ? { scale, offsetX: -clip.x * scale, offsetY: -clip.y * scale } : { scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(clip ? clip.w * scale : vp.width); canvas.height = Math.ceil(clip ? clip.h * scale : vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas, vp, img: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}
/** Free a canvas's memory now (iOS keeps it until collected otherwise). */
export const freeCanvas = (c) => { if (c) { c.width = 0; c.height = 0; } };

/** Image placements on a page, in raster coordinates of `vp`, plus counts for a quick "could be a chart" test. */
async function pageShapes(page, vp, w, h, pdfjs) {
  const ol = await page.getOperatorList(); const O = pdfjs.OPS;
  let ctm = [1, 0, 0, 1, 0, 0]; const st = [], images = []; let paths = 0;
  ol.fnArray.forEach((fn, k) => {
    const a = ol.argsArray[k];
    if (fn === O.save) st.push(ctm); else if (fn === O.restore) ctm = st.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.constructPath) paths++;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => vp.convertToViewportPoint(ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const r = { x0: Math.max(0, Math.floor(Math.min(...xs))), x1: Math.min(w, Math.ceil(Math.max(...xs))), y0: Math.max(0, Math.floor(Math.min(...ys))), y1: Math.min(h, Math.ceil(Math.max(...ys))) };
      if (r.x1 - r.x0 > 40 && r.y1 - r.y0 > 40) images.push(r);
    }
  });
  return { images, paths };
}

function largest(img, regions) {
  let best = null;
  for (const r of regions) {
    const g = findGrid(img, r);
    if (g && (!best || g.cols * g.rows > best.cols * best.rows)) best = g;
  }
  return best;
}

/**
 * Is there a chart grid on this page? Returns "cols×rows" or ''. Fast pass at ~1200 px; pages with
 * pictures or many drawn lines (where a small-celled chart could be) get a second look at ~2400 px.
 */
export async function quickScan(page, pdfjs) {
  let shapes = null;
  for (const side of [1200, 2400]) {
    const S = workScale(page, side);
    const { canvas, vp, img } = await renderPage(page, S);
    shapes = await pageShapes(page, vp, img.width, img.height, pdfjs);
    const g = largest(img, [...shapes.images, { x0: 0, x1: img.width, y0: 0, y1: img.height }]);
    freeCanvas(canvas);
    if (g && g.cols * g.rows >= 16) return `${g.cols}×${g.rows}`;
    if (!shapes.images.length && shapes.paths < 100) return '';
  }
  return '';
}

/**
 * Read the chart on a page. Returns null when no grid is found, else:
 * { page, pageCanvas, pageScale, detail ('page' | 'area ×S' | 'page (close-up did not match)'), gridPage (lattice in page-canvas px), cellCanvas, grid (lattice in
 *   cell-canvas px), res (readCells), legend: Map(key → { page, span, text, img, swatch, label }),
 *   unused: [legend lines on this page not used], name }
 */
export async function readChart(doc, pnum, pdfjs) {
  const page = await doc.getPage(pnum);
  const S0 = workScale(page);
  const p0 = await renderPage(page, S0);
  const shapes = await pageShapes(page, p0.vp, p0.img.width, p0.img.height, pdfjs);
  const g0 = largest(p0.img, [...shapes.images, { x0: 0, x1: p0.img.width, y0: 0, y1: p0.img.height }]);
  if (!g0) { freeCanvas(p0.canvas); return null; }
  // Small cells: read the chart's area again at a higher scale (area only, within the pixel cap).
  let cellCanvas = p0.canvas, img = p0.img, g = g0, k = 1, ox = 0, oy = 0, detail = 'page';
  if (Math.min(...g0.pitch) < 40) {
    const m = Math.max(...g0.pitch);
    const area = { x: Math.max(0, g0.xs[0] - m) / S0, y: Math.max(0, g0.ys[0] - m) / S0 };
    area.w = Math.min(p0.img.width, g0.xs[g0.cols] + m) / S0 - area.x; area.h = Math.min(p0.img.height, g0.ys[g0.rows] + m) / S0 - area.y;
    let S1 = Math.ceil((S0 * 44 / Math.min(...g0.pitch)) * 2) / 2;
    while (S1 > S0 && area.w * area.h * S1 * S1 > MAX_PIXELS) S1 -= 0.5;
    if (S1 > S0) {
      const r = await renderPage(page, S1, area);
      const g1 = findGrid(r.img, { x0: 0, x1: r.img.width, y0: 0, y1: r.img.height });
      if (g1 && g1.cols === g0.cols && g1.rows === g0.rows) { cellCanvas = r.canvas; img = r.img; g = g1; k = S1 / S0; ox = area.x * S0; oy = area.y * S0; detail = `area ×${S1}`; }
      else { freeCanvas(r.canvas); detail = 'page (close-up did not match)'; }
    }
  }
  const res = readCells(img, g);
  // The lattice in page-canvas pixels (for the source view and the legend search).
  const gridPage = { ...g, xs: g.xs.map((x) => x / k + ox), ys: g.ys.map((y) => y / k + oy), pitch: g.pitch.map((p) => p / k) };
  const legend = new Map(), unused = [];
  const tb0 = textBoxes(await page.getTextContent(), p0.vp);
  const L = readLegend(p0.img, gridPage, res.classes, res.glyphs);
  for (const [key, m] of L.matches) legend.set(key, { ...m, page: pnum, text: legendText(tb0, m.swatch, m.label), img: lineImage(p0.canvas, m.swatch, m.label) });
  for (const u of L.unused) unused.push({ ...u, page: pnum, text: legendText(tb0, u.swatch, u.label), img: lineImage(p0.canvas, u.swatch, u.label) });
  const missing = new Set(res.classes.map((_, key) => key).filter((key) => !res.classes[key].outside && !legend.has(key)));
  for (let q = 1; q <= doc.numPages && missing.size; q++) {
    if (q === pnum) continue;
    const op = await doc.getPage(q);
    const o = await renderPage(op, S0);
    const OL = readLegend(o.img, gridPage, res.classes, res.glyphs, { wholePage: true, keys: missing });
    if (OL.matches.size) {
      const tb = textBoxes(await op.getTextContent(), o.vp);
      for (const [key, m] of OL.matches) { legend.set(key, { ...m, page: q, text: legendText(tb, m.swatch, m.label), img: lineImage(o.canvas, m.swatch, m.label) }); missing.delete(key); }
    }
    freeCanvas(o.canvas);
    op.cleanup();
  }
  return { page: pnum, pageCanvas: p0.canvas, pageScale: S0, gridPage, cellCanvas, grid: g, res, legend, unused, name: chartName(tb0, gridPage, pnum), detail };
}

/** A crop of one legend line (swatch + label) from a rendered page, as a data URL. */
function lineImage(canvas, sw, lb) {
  const pad = 4, x0 = Math.max(0, Math.min(sw.x0, lb.x0) - pad), y0 = Math.max(0, Math.min(sw.y0, lb.y0) - pad);
  const x1 = Math.min(canvas.width, Math.max(sw.x1, lb.x1) + pad), y1 = Math.min(canvas.height, Math.max(sw.y1, lb.y1) + pad);
  const h = Math.min(60, Math.max(30, Math.round((y1 - y0) / 3))), w = Math.round(h * (x1 - x0) / (y1 - y0));
  const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2;
  cv.getContext('2d').drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, w * 2, h * 2);
  return cv.toDataURL('image/png');
}

/** A crop of one cell (inside its lines) as a small PNG data URL. */
export function cellImage(canvas, g, r, c) {
  const x0 = g.xs[c], x1 = g.xs[c + 1], y0 = g.ys[r], y1 = g.ys[r + 1];
  const ix = (x1 - x0) * 0.07, iy = (y1 - y0) * 0.07;
  const w = 40, h = Math.max(8, Math.round(40 * (y1 - y0) / (x1 - x0)));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(canvas, x0 + ix, y0 + iy, x1 - x0 - 2 * ix, y1 - y0 - 2 * iy, 0, 0, w, h);
  return cv.toDataURL('image/png');
}

/**
 * A default name: a "Chart …" caption on the page (nearest the chart), else the nearest heading above
 * the chart (text larger than the page's usual size), else the nearest text line above, else "Chart, page N".
 */
function chartName(boxes, g, pnum) {
  const cy = (g.ys[0] + g.ys[g.rows]) / 2, cx = (g.xs[0] + g.xs[g.cols]) / 2;
  const caption = boxes.filter((b) => /^\s*chart\s*[a-z0-9]{1,3}\b/i.test(b.s))
    .sort((a, b) => Math.hypot(a.x0 - cx, a.top - cy) - Math.hypot(b.x0 - cx, b.top - cy))[0];
  if (caption) return caption.s.trim();
  const sizes = boxes.map((b) => b.h).sort((a, b) => a - b), body = sizes[sizes.length >> 1] || 0;
  const heading = boxes.length < 6 ? null : boxes.filter((b) => b.base <= g.ys[0] + 2 && b.h > body * 1.1 && b.s.trim().length > 2).sort((a, b) => b.base - a.base)[0];
  const near = heading || boxes.filter((b) => b.base <= g.ys[0] + 2 && b.s.trim().length > 2 && !/copyright|©/i.test(b.s)).sort((a, b) => b.base - a.base)[0];
  return near ? near.s.trim().replace(/[:：]\s*$/, '') : `Chart, page ${pnum}`;
}
