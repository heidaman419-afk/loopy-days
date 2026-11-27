// Legend finder: locates legend swatches on a rendered page, matches each to a chart key (class) by fill
// and symbol, and finds the label area to the right of each swatch. Pure JS on RGBA, no dependencies,
// no OCR: the label is returned as a box (to show as a picture); real PDF text is matched separately.
import { cellFeature, maskDist } from './chart-grid.js';

const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Slant of a glyph mask: correlation of x with y over its ink. About −1 for "/", +1 for "\\", ~0 otherwise. */
function slant(mask) {
  const G = Math.round(Math.sqrt(mask.length)); let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const m = mask[y * G + x]; n += m; sx += m * x; sy += m * y; sxx += m * x * x; syy += m * y * y; sxy += m * x * y; }
  if (n < 1) return 0;
  const vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2, cv = sxy / n - (sx / n) * (sy / n);
  return vx > 0 && vy > 0 ? cv / Math.sqrt(vx * vy) : 0;
}

/** Most common colour on the page (16-level buckets, then that bucket's exact mean): the paper. */
export function background(img) {
  const d = img.data, hist = new Map();
  for (let i = 0; i < d.length; i += 4 * 7) {
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const h = hist.get(k) || [0, 0, 0, 0]; h[0]++; h[1] += d[i]; h[2] += d[i + 1]; h[3] += d[i + 2]; hist.set(k, h);
  }
  let top = null; for (const h of hist.values()) if (!top || h[0] > top[0]) top = h;
  return [top[1] / top[0], top[2] / top[0], top[3] / top[0]];
}

// Ink = differs from the paper by more than this. Legend outlines can be very faint hairlines.
const INK = 24;

/**
 * Ink mask (differs from the paper) and 4-connected components, skipping the chart lattice itself.
 * Returns { ink: Uint8Array, comps: [{ x0, y0, x1, y1, n, id }], label: Int32Array }.
 */
export function components(img, skip, bg) {
  const { width: W, height: H, data: d } = img;
  const ink = new Uint8Array(W * H);
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) {
    if (x >= skip.x0 && x < skip.x1 && y >= skip.y0 && y < skip.y1) continue;
    const i = p * 4;
    if (Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) > INK) ink[p] = 1;
  }
  const label = new Int32Array(W * H).fill(-1), comps = [], stack = new Int32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    if (!ink[p] || label[p] >= 0) continue;
    const id = comps.length, c = { id, x0: W, y0: H, x1: -1, y1: -1, n: 0 };
    let sp = 0; stack[sp++] = p; label[p] = id;
    while (sp) {
      const q = stack[--sp], x = q % W, y = (q / W) | 0;
      c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && ink[q - 1] && label[q - 1] < 0) { label[q - 1] = id; stack[sp++] = q - 1; }
      if (x < W - 1 && ink[q + 1] && label[q + 1] < 0) { label[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && ink[q - W] && label[q - W] < 0) { label[q - W] = id; stack[sp++] = q - W; }
      if (y < H - 1 && ink[q + W] && label[q + W] < 0) { label[q + W] = id; stack[sp++] = q + W; }
    }
    comps.push(c);
  }
  return { ink, comps, label };
}

/**
 * Swatch candidates: components whose bounding box edge is almost all their own ink (a filled or
 * outlined box), roughly square-ish, and about cell-sized (0.5×–3× the chart's cell).
 */
export function swatches(img, g, cc) {
  const W = img.width, pmin = Math.min(...g.pitch), pmax = Math.max(...g.pitch), out = [];
  for (const c of cc.comps) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (Math.min(w, h) < pmin * 0.5 || Math.max(w, h) > pmax * 12) continue;
    const own = (x, y) => cc.label[y * W + x] === c.id;
    // Touching boxes share borders and form one component: split it along internal lines that run
    // (almost) its full width or height, then test each part as a box.
    const lines = (vertical) => {
      const n0 = vertical ? c.x0 : c.y0, n1 = vertical ? c.x1 : c.y1, len = vertical ? h : w, runs = [];
      for (let t = n0 + 3; t <= n1 - 3; t++) {
        let on = 0;
        for (let u = 0; u < len; u++) on += vertical ? own(t, c.y0 + u) : own(c.x0 + u, t);
        if (on / len >= 0.85) { const last = runs[runs.length - 1]; if (last && t - last.e <= 2) last.e = t; else runs.push({ s: t, e: t }); }
      }
      // A thin run is a shared border (cut at its middle); a long run is a filled box (cut at its edges).
      const cuts = [];
      for (const k of runs) {
        if (k.e - k.s <= pmin * 0.2) cuts.push((k.s + k.e) / 2);
        else { if (k.s > n0 + 3) cuts.push(k.s); if (k.e < n1 - 3) cuts.push(k.e); }
      }
      return [n0, ...cuts, n1 + 1];
    };
    const xs = (w > pmax * 1.6) ? lines(true) : [c.x0, c.x1 + 1], ys = (h > pmax * 1.6) ? lines(false) : [c.y0, c.y1 + 1];
    const parts = [];
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
      const bx0 = Math.round(xs[i]), bx1 = Math.round(xs[i + 1]), by0 = Math.round(ys[j]), by1 = Math.round(ys[j + 1]);
      const bw = bx1 - bx0, bh = by1 - by0;
      if (Math.min(bw, bh) < pmin * 0.5 || Math.max(bw, bh) > pmax * 3) continue;
      if (bw / bh < 0.4 || bw / bh > 2.5) continue;
      // Each side must be (almost) all this component's ink; edges can be patchy at the very outside
      // or sit a pixel off a shared border, so each side is measured within 2 px and its best row counts.
      const inb = (x, y) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && own(x, y);
      const side = (fn, n) => { let best = 0; for (let o = -2; o <= 2; o++) { let on = 0; for (let t = 0; t < n; t++) on += fn(t, o); best = Math.max(best, on / n); } return best; };
      const sides = [
        side((t, o) => inb(bx0 + t, by0 + o), bw), side((t, o) => inb(bx0 + t, by1 - 1 + o), bw),
        side((t, o) => inb(bx0 + o, by0 + t), bh), side((t, o) => inb(bx1 - 1 + o, by0 + t), bh),
      ];
      if (Math.min(...sides) >= 0.85) parts.push({ x0: bx0, y0: by0, x1: bx1, y1: by1 });
    }
    // The boxes must make up (almost) the whole shape; otherwise it is a drawing (e.g. a decrease
    // staircase diagram), not swatches.
    const area = parts.reduce((t, b) => t + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
    if (parts.length && area >= w * h * 0.85) out.push(...parts);
  }
  return out;
}

/** The label to the right of a swatch: ink in the swatch's band, until a wide gap. Box or null. */
export function labelBox(img, cc, s, all) {
  const W = img.width, h = s.y1 - s.y0, band0 = Math.max(0, Math.round(s.y0 - h * 0.15)), band1 = Math.min(img.height, Math.round(s.y1 + h * 0.15));
  const maxGap = Math.max(6, h * 1.5), maxStart = h * 4;
  const blocked = (x) => all.some((o) => o !== s && x >= o.x0 && x < o.x1 && o.y1 > band0 && o.y0 < band1);
  let x0 = -1, x1 = -1, y0 = Infinity, y1 = -1, gap = 0;
  for (let x = s.x1 + 2; x < W; x++) {
    if (blocked(x)) break;
    let col = false;
    for (let y = band0; y < band1; y++) if (cc.ink[y * W + x]) { col = true; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    // A label starts after a clear gap (≥ a quarter of the swatch width); ink right against the box is
    // the rest of a word (a letter that looked like a box), not a legend line.
    if (col && x0 < 0 && x - s.x1 < (s.x1 - s.x0) * 0.25) return null;
    if (col) { if (x0 < 0) x0 = x; x1 = x; gap = 0; }
    else if (x0 >= 0 && ++gap > maxGap) break;
    else if (x0 < 0 && x - s.x1 > maxStart) break;
  }
  return x0 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Swatches drawn as a row of touching boxes (e.g. "/ /" for a 2-cell decrease) are one legend swatch.
 * Groups of 3+ boxes, or boxes that touch boxes in the rows above or below (a diagram like a decrease
 * staircase), are figures, not legend swatches.
 */
function groupBoxes(boxes) {
  const h = (b) => b.y1 - b.y0, w = (b) => b.x1 - b.x0;
  const sameRow = (a, b) => Math.abs(a.y0 - b.y0) < h(a) * 0.25 && Math.abs(a.y1 - b.y1) < h(a) * 0.25;
  const touchH = (a, b) => sameRow(a, b) && b.x0 - a.x1 >= -3 && b.x0 - a.x1 <= w(a) * 0.25;
  const touchV = (a, b) => b.y0 - a.y1 >= -3 && b.y0 - a.y1 <= h(a) * 0.25 && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > Math.min(w(a), w(b)) * 0.5;
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0), groups = [];
  for (const b of sorted) {
    const gr = groups.find((g) => touchH(g.members[g.members.length - 1], b));
    if (gr) { gr.members.push(b); gr.x1 = Math.max(gr.x1, b.x1); gr.y0 = Math.min(gr.y0, b.y0); gr.y1 = Math.max(gr.y1, b.y1); }
    else groups.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, members: [b] });
  }
  // Mark groups that are part of a figure: a member touching a box above/below that sits in a group of 2+.
  for (const g of groups) {
    g.figure = g.members.length > 2 || groups.some((o) => o !== g && (o.members.length > 1 || g.members.length > 1)
      && g.members.some((m) => o.members.some((n) => touchV(m, n) || touchV(n, m))));
  }
  return groups.filter((g) => !g.figure).map((g) => ({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, span: g.members.length, first: g.members[0] }));
}

/** A label on the line(s) just below a swatch (when nothing sits to its right). Box or null. */
function labelBelow(img, cc, s, all) {
  const W = img.width, H = img.height, h = s.y1 - s.y0;
  const xa = Math.max(0, Math.round(s.x0 - h * 0.5)), xb = W;
  const yStart = s.y1 + 2, yMax = Math.min(H, Math.round(s.y1 + h * 1.4));
  if (all.some((o) => o !== s && o.y0 >= s.y1 - 2 && o.y0 < yMax && o.x1 > xa && o.x0 < s.x1 + h * 4)) return null; // another swatch below
  let y0 = -1, y1 = -1, x0 = Infinity, x1 = -1, gap = 0;
  for (let y = yStart; y < H; y++) {
    let row = false;
    for (let x = xa; x < Math.min(xb, s.x0 + h * 40); x++) if (cc.ink[y * W + x]) { row = true; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (row) { if (y0 < 0) { if (y > yMax) break; y0 = y; } y1 = y; gap = 0; }
    else if (y0 >= 0 && ++gap > h * 0.5) break;
  }
  if (y0 < 0 || x0 > s.x0 + h * 2) return null; // must start under the swatch, not far to the right
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Find the legend for a read chart. keys: res.classes from readCells; glyphs: res.glyphs.
 * opts.wholePage: search a page other than the chart's (no lattice to skip).
 * Returns { matches: Map(keyIndex → { swatch, label, score, span }), unused: [legend lines not matching any key] }.
 */
export function readLegend(img, g, classes, glyphs, opts = {}) {
  const skip = opts.wholePage ? { x0: 0, x1: 0, y0: 0, y1: 0 } : { x0: g.xs[0] - 2, x1: g.xs[g.cols] + 2, y0: g.ys[0] - 2, y1: g.ys[g.rows] + 2 };
  const bg = background(img);
  const cc = components(img, skip, bg);
  // A legend line = a swatch (one box, or two touching boxes) with a label to its right or just below.
  const groups = groupBoxes(swatches(img, g, cc));
  const sw = groups.map((s) => ({ ...s, label: labelBox(img, cc, s, groups) || labelBelow(img, cc, s, groups) })).filter((s) => s.label)
    .map((s) => ({ ...s, f: cellFeature(img, s.first.x0, s.first.x1, s.first.y0, s.first.y1) }));
  const blank = new Float32Array(glyphs[0]?.mask.length || 144);
  const pairs = [];
  classes.forEach((C, k) => {
    if (C.outside || (opts.keys && !opts.keys.has(k))) return;
    const cm = C.glyphId < 0 ? blank : glyphs[C.glyphId].mask;
    sw.forEach((s, j) => {
      const plainS = s.f.ink < 0.03, plainC = C.glyphId < 0;
      if (plainS !== plainC) return;
      pairs.push({ k, j, score: rgbDist(C.fill, s.f.fill) / 255 + (plainC ? 0 : maskDist(cm, s.f.mask) * 4) });
    });
  });
  pairs.sort((a, b) => a.score - b.score);
  const matches = new Map(), usedS = new Set();
  for (const p of pairs) {
    if (p.score > 0.6 || matches.has(p.k) || usedS.has(p.j)) continue;
    const s = sw[p.j];
    matches.set(p.k, { swatch: { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }, label: s.label, score: +p.score.toFixed(3), span: s.span }); usedS.add(p.j);
  }
  // Fallback for slashes (decreases): designers draw the same slash short in the chart and tall in the
  // legend, so the shapes differ, but the slant direction (rising / or falling \\) matches. A symbol may
  // also sit on a different background colour in the chart than in the legend.
  classes.forEach((C, k) => {
    if (C.outside || C.glyphId < 0 || matches.has(k) || (opts.keys && !opts.keys.has(k))) return;
    const sk = slant(glyphs[C.glyphId].mask);
    if (Math.abs(sk) < 0.5) return;
    let best = null;
    sw.forEach((s, j) => {
      if (s.f.ink < 0.03) return;
      const ss = slant(s.f.mask);
      if (Math.abs(ss) < 0.5 || Math.sign(ss) !== Math.sign(sk)) return;
      const score = 0.45 + (rgbDist(C.fill, s.f.fill) > 40 ? 0.1 : 0) + (usedS.has(j) ? 0.05 : 0);
      if (!best || score < best.score) best = { j, score };
    });
    if (best) { const s = sw[best.j]; matches.set(k, { swatch: { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }, label: s.label, score: best.score, span: s.span, how: 'slant' }); usedS.add(best.j); }
  });
  const unused = sw.filter((_, j) => !usedS.has(j)).map((s) => ({ swatch: { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }, label: s.label, span: s.span }));
  return { matches, unused };
}
