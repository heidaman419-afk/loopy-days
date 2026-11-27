// Chart grid reader: finds a regular cell lattice in a page raster and sorts the cells into classes.
// Pure JS, no dependencies, works on { width, height, data: RGBA Uint8(Clamped)Array } so the same
// code can run on a pdf.js canvas in the browser. No pattern-specific numbers, colours or positions.

// Colour distance between two pixels (so a grey line on a teal cell counts even at equal brightness).
const cd = (d, i, j) => Math.hypot(d[i] - d[j], d[i + 1] - d[j + 1], d[i + 2] - d[j + 2]);
/** Is there a line or colour step at pixel c, comparing pixels a and b on either side? */
const edgeAt = (d, a, b, c, T) => cd(d, a, b) > T || (cd(d, c, a) > T / 2 && cd(d, c, b) > T / 2);

/** Per-position edge counts along one axis inside rect r. axis 'x' → vertical lines. */
export function projection(img, r, axis) {
  const { width: W, data: d } = img;
  const n = axis === 'x' ? r.x1 - r.x0 : r.y1 - r.y0;
  const out = new Float64Array(n);
  const T = 40;
  if (axis === 'x') {
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0 + 1; x < r.x1 - 1; x++) {
      if (edgeAt(d, (y * W + x - 1) * 4, (y * W + x + 1) * 4, (y * W + x) * 4, T)) out[x - r.x0]++;
    }
  } else {
    for (let x = r.x0; x < r.x1; x++) for (let y = r.y0 + 1; y < r.y1 - 1; y++) {
      if (edgeAt(d, ((y - 1) * W + x) * 4, ((y + 1) * W + x) * 4, (y * W + x) * 4, T)) out[y - r.y0]++;
    }
  }
  return out;
}

/** Peaks of a projection, merged when within 6 px (cells are ≥ ~20 px at the working scale). */
export function peaks(p, frac = 0.25) {
  let max = 0; for (const v of p) max = Math.max(max, v);
  const pts = [];
  for (let i = 1; i < p.length - 1; i++) if (p[i] >= frac * max && p[i] >= p[i - 1] && p[i] >= p[i + 1]) pts.push(i);
  const merged = [];
  for (const x of pts) {
    const last = merged[merged.length - 1];
    // Both edges of a thick soft line become one line.
    if (last && x - last.end <= 6) { last.end = x; if (p[x] > last.w) { last.w = p[x]; } }
    else merged.push({ start: x, end: x, w: p[x] });
  }
  return merged.map((m) => (m.start + m.end) / 2);
}

/**
 * Chains of equally spaced positions (pitch ≥ minPitch, tolerance 12% of pitch), strongest first, distinct.
 * Strength = sum of the projection at each line (proj given), so full-height grid lines outrank the many
 * short, regularly spaced edges of text; without proj, longest first.
 */
export function combs(pos, minPitch = 8, max = 6, proj = null) {
  const all = [];
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    const pitch = pos[j] - pos[i];
    if (pitch < minPitch) continue;
    const tol = Math.max(2, pitch * 0.12);
    const chain = [pos[i], pos[j]];
    let k = j;
    for (;;) {
      const want = chain[chain.length - 1] + pitch;
      let hit = -1;
      for (let m = k + 1; m < pos.length && pos[m] <= want + tol; m++) if (Math.abs(pos[m] - want) <= tol) { hit = m; break; }
      if (hit < 0) break;
      chain.push(pos[hit]); k = hit;
    }
    if (chain.length >= 4) all.push(chain);
  }
  const strength = (c) => (proj ? c.reduce((t, v) => t + proj[Math.round(v)], 0) : c.length);
  all.sort((p, q) => strength(q) - strength(p));
  const out = [];
  for (const c of all) {
    // Skip chains that mostly reuse the lines of one already kept.
    if (out.some((o) => c.filter((v) => o.includes(v)).length > c.length / 2)) continue;
    out.push(c); if (out.length >= max) break;
  }
  return out;
}

/**
 * Move each comb position to the centre of its line: the max of the projection smoothed over ~8% of a
 * cell, searched only within ±12% of a cell around where the regular spacing predicts the line.
 */
function snap(proj, comb) {
  if (comb.length < 2) return comb;
  const n = comb.length, pitch = (comb[n - 1] - comb[0]) / (n - 1);
  // Least-squares fit of position = a + k·pitch gives the predicted line positions.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  comb.forEach((v, k) => { sx += k; sy += v; sxx += k * k; sxy += k * v; });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n;
  const rad = Math.max(1, Math.round(pitch * 0.08)), win = Math.max(2, Math.round(pitch * 0.12));
  const sm = new Float64Array(proj.length);
  for (let i = 0; i < proj.length; i++) { let t = 0; for (let k = -rad; k <= rad; k++) t += proj[Math.min(proj.length - 1, Math.max(0, i + k))]; sm[i] = t; }
  return comb.map((_, k) => {
    const c = Math.round(icpt + slope * k);
    let best = c, bv = -1, lo = c, hi = c;
    for (let i = Math.max(0, c - win); i <= Math.min(sm.length - 1, c + win); i++) {
      if (sm[i] > bv) { bv = sm[i]; best = lo = hi = i; } else if (sm[i] === bv && i === hi + 1) hi = i;
    }
    return (lo + hi) / 2;
  });
}

/**
 * Fraction of the span [from,to] where a cell boundary sits at position p: either the two cell
 * interiors (30% of a pitch away on each side) differ, or some pixel within the line window differs
 * from both interiors (a drawn line, thin or thick).
 */
export function coverage(img, axis, p, from, to, pitch, offF = 0.3, winF = 0.08) {
  const { width: W, data: d } = img; const T = 40; let hit = 0, n = 0;
  const off = Math.max(2, Math.round(pitch * offF)), win = Math.max(1, Math.round(pitch * winF));
  const lim = axis === 'x' ? W : img.height;
  for (let t = Math.ceil(from) + 1; t < to - 1; t++) {
    const at = (u) => { u = Math.min(lim - 1, Math.max(0, u)); return axis === 'x' ? (t * W + u) * 4 : (u * W + t) * 4; };
    const q = Math.round(p), A = at(q - off), B = at(q + off);
    n++;
    if (cd(d, A, B) > T) { hit++; continue; }
    for (let o = -win; o <= win; o++) { const c = at(q + o); if (cd(d, c, A) > T / 2 && cd(d, c, B) > T / 2) { hit++; break; } }
  }
  return n ? hit / n : 0;
}

/** Find the cell lattice inside rect r. Returns { xs, ys, pitch, cols, rows } (absolute) or null. */
export function findGrid(img, r, debug = null) {
  // Every candidate comb is grown and validated; the validated lattice with the most cells wins
  // (a coarser lattice made of every second line also validates, so "first found" is not enough).
  const pjx = projection(img, r, 'x');
  let best = null;
  for (const cx of combs(peaks(pjx), 8, 6, pjx)) {
    const g = growFrom(img, r, snap(pjx, cx).map((v) => v + r.x0), debug);
    if (g && (!best || g.cols * g.rows > best.cols * best.rows)) best = g;
  }
  return best;
}

const MIN_COVER = 0.85; // a real grid line is present along ≥ 85% of the lattice

function growFrom(img, r, xs0, debug) {
  let xs = xs0, ys = [];
  let rect = { ...r };
  for (let pass = 0; pass < 3; pass++) {
    if (pass) {
      const pjx = projection(img, rect, 'x');
      const cx = combs(peaks(pjx), 8, 6, pjx).find((c) => c.some((v) => Math.abs(v + rect.x0 - xs[0]) < 3 || Math.abs(v + rect.x0 - xs[xs.length - 1]) < 3));
      // Refinement may move lines but never drops them: keep the re-found comb only if it is as long.
      if (cx && cx.length >= xs.length) xs = snap(pjx, cx).map((v) => v + rect.x0);
    }
    const xr = { ...rect, x0: Math.max(r.x0, Math.floor(xs[0] + 2)), x1: Math.min(r.x1, Math.ceil(xs[xs.length - 1] - 2)) };
    const pjy = projection(img, xr, 'y');
    const cy = combs(peaks(pjy), 8, 6, pjy)[0];
    if (!cy) return null;
    ys = snap(pjy, cy).map((v) => v + rect.y0);
    const padY = (ys[ys.length - 1] - ys[0]) / (ys.length - 1) / 2;
    // Keep half a cell of margin so the outer lines stay inside the next projection.
    rect = { x0: r.x0, x1: r.x1, y0: Math.max(r.y0, Math.floor(ys[0] - padY)), y1: Math.min(r.y1, Math.ceil(ys[ys.length - 1] + padY)) };
  }
  // A real grid line runs the full length of the lattice; text lines and label digits do not.
  // Trim outer lines whose coverage is low, until both ends hold.
  const pitchOf = (v) => (v[v.length - 1] - v[0]) / (v.length - 1);
  const cov = (axis, p) => axis === 'x' ? coverage(img, 'x', p, ys[0], ys[ys.length - 1], pitchOf(xs)) : coverage(img, 'y', p, xs[0], xs[xs.length - 1], pitchOf(ys));
  if (debug) debug.push({ start: xs0.length, xs: xs.map(Math.round), ys: ys.map(Math.round), covx: xs.map((p) => +cov('x', p).toFixed(2)), covy: ys.map((p) => +cov('y', p).toFixed(2)) });
  for (let changed = true; changed;) {
    changed = false;
    if (xs.length < 3 || ys.length < 3) return null;
    if (cov('x', xs[0]) < MIN_COVER) { xs = xs.slice(1); changed = true; }
    else if (cov('x', xs[xs.length - 1]) < MIN_COVER) { xs = xs.slice(0, -1); changed = true; }
    else if (cov('y', ys[0]) < MIN_COVER) { ys = ys.slice(1); changed = true; }
    else if (cov('y', ys[ys.length - 1]) < MIN_COVER) { ys = ys.slice(0, -1); changed = true; }
  }
  // Grow: while a full-length line continues one pitch past an end, the lattice is cut short; extend it
  // (search ±12% of a cell for the best line). A truncated grid must never pass as a whole one.
  const growEnd = (axis, atStart) => {
    const v = axis === 'x' ? xs : ys, pt = pitchOf(v), lim = axis === 'x' ? img.width : img.height;
    const base = atStart ? v[0] - pt : v[v.length - 1] + pt;
    let best = -1, bc = 0;
    for (let o = -Math.round(pt * 0.12); o <= Math.round(pt * 0.12); o++) {
      const p = base + o; if (p < 2 || p > lim - 3) continue;
      const c = cov(axis, p); if (c > bc) { bc = c; best = p; }
    }
    if (bc < MIN_COVER) return false;
    if (axis === 'x') xs = atStart ? [best, ...xs] : [...xs, best]; else ys = atStart ? [best, ...ys] : [...ys, best];
    return true;
  };
  for (let grown = true, n = 0; grown && n < 400; n++) grown = growEnd('x', true) || growEnd('x', false) || growEnd('y', true) || growEnd('y', false);
  if (xs.some((p) => cov('x', p) < MIN_COVER) || ys.some((p) => cov('y', p) < MIN_COVER)) { debug?.push('weak inner line'); return null; } // inner line missing
  // A chart lattice is regular (every gap within 25% of the mean; snapped lines can wobble a few px) and has no full-length line running
  // through the inside of its cells (else it is a coarser lattice of every n-th line). Otherwise fail
  // visibly, so the knitter gets the manual grid instead of a wrong one.
  const even = (v) => { const m = pitchOf(v); return v.slice(1).every((x, i) => Math.abs(x - v[i] - m) <= m * 0.25); };
  if (!even(xs) || !even(ys)) { debug?.push('uneven ' + JSON.stringify(xs.map(Math.round)) + ' ' + JSON.stringify(ys.map(Math.round))); return null; }
  // Sweep the middle of each cell (30%–70%; any every-n-th-line lattice has an inner line there) with
  // close-in reference points (±10% of a cell), clear of the cell's own border lines.
  const inner = (axis, v) => {
    const pt = pitchOf(v), span = axis === 'x' ? [ys[0], ys[ys.length - 1]] : [xs[0], xs[xs.length - 1]];
    for (let i = 0; i + 1 < v.length; i++) for (let f = 0.3; f <= 0.701; f += 0.04) {
      if (coverage(img, axis, v[i] + (v[i + 1] - v[i]) * f, span[0], span[1], pt, 0.1, 0.02) >= MIN_COVER) return true;
    }
    return false;
  };
  if (inner('x', xs) || inner('y', ys)) { debug?.push('line inside cells'); return null; }
  const px = (xs[xs.length - 1] - xs[0]) / (xs.length - 1), py = (ys[ys.length - 1] - ys[0]) / (ys.length - 1);
  return { xs, ys, pitch: [px, py], cols: xs.length - 1, rows: ys.length - 1 };
}

const G = 12; // glyph descriptor size (G×G)

/** Fill colour + glyph mask for the cell between lines (x0,x1,y0,y1). */
export function cellFeature(img, x0, x1, y0, y1) {
  const { width: W, data: d } = img;
  const ix = (x1 - x0) * 0.14, iy = (y1 - y0) * 0.14;
  const a0 = Math.ceil(x0 + ix), a1 = Math.floor(x1 - ix), b0 = Math.ceil(y0 + iy), b1 = Math.floor(y1 - iy);
  // Fill = the most common colour in the interior (16-level buckets per channel, then the mean of
  // that bucket). Glyph strokes and blurred line edges are minorities, so they do not shift it.
  const hist = new Map();
  for (let y = b0; y < b1; y++) for (let x = a0; x < a1; x++) {
    const i = (y * W + x) * 4, key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const h = hist.get(key) || [0, 0, 0, 0]; h[0]++; h[1] += d[i]; h[2] += d[i + 1]; h[3] += d[i + 2]; hist.set(key, h);
  }
  let top = null; for (const h of hist.values()) if (!top || h[0] > top[0]) top = h;
  const fill = [top[1] / top[0], top[2] / top[0], top[3] / top[0]].map(Math.round);
  // Ink = pixels far from the fill. The glyph mask is taken over the ink's own bounding square,
  // so the same symbol drawn a pixel off-centre or at another render scale gives the same mask.
  let ink = 0, tot = 0, mx0 = Infinity, mx1 = -1, my0 = Infinity, my1 = -1;
  const on = new Uint8Array((a1 - a0) * (b1 - b0));
  for (let y = b0; y < b1; y++) for (let x = a0; x < a1; x++) {
    const i = (y * W + x) * 4;
    if (Math.hypot(d[i] - fill[0], d[i + 1] - fill[1], d[i + 2] - fill[2]) > 90) {
      on[(y - b0) * (a1 - a0) + (x - a0)] = 1; ink++;
      if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y;
    }
    tot++;
  }
  const mask = new Float32Array(G * G), cnt = new Float32Array(G * G);
  if (ink) {
    const side = Math.max(mx1 - mx0, my1 - my0) + 1, cx = (mx0 + mx1) / 2, cy = (my0 + my1) / 2;
    for (let y = b0; y < b1; y++) for (let x = a0; x < a1; x++) {
      const u = (x - cx) / side + 0.5, v = (y - cy) / side + 0.5;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const k = Math.floor(v * G) * G + Math.floor(u * G);
      mask[k] += on[(y - b0) * (a1 - a0) + (x - a0)]; cnt[k]++;
    }
    for (let k = 0; k < mask.length; k++) mask[k] = cnt[k] ? mask[k] / cnt[k] : 0;
  }
  return { fill, mask, ink: ink / tot };
}

const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Mean absolute difference, best over shifts of one descriptor cell (tolerates rounding). */
export function maskDist(a, b) {
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    let s = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const yy = y + dy, xx = x + dx;
      s += Math.abs(a[y * G + x] - (yy >= 0 && yy < G && xx >= 0 && xx < G ? b[yy * G + xx] : 0));
    }
    best = Math.min(best, s / (G * G));
  }
  return best;
}

/**
 * Read every cell and group into classes = (fill group, glyph group).
 * Glyph groups are shared across fills, so "circle on white" and "circle on black" share a glyph.
 * Returns { grid: rows top→bottom of class ids, classes, cells (with confidence) }.
 */

/**
 * Background grid vs chart. Spreadsheet-made charts sit on a faint page-wide grid; only real chart cells
 * have dark outlines. Measures every lattice edge between light cells (darkest pixel across the line,
 * median along it). If those edges split clearly into dark and faint (gap ≥ 80 brightness, dark side's
 * median ≤ 120, each side ≥ 3%), a light cell with any faint edge is outside the chart. Otherwise nothing is outside (e.g.
 * all lines alike). Returns a Set of "r,c" plus the threshold used (or null).
 */
function outsideCells(img, g, cells) {
  const { width: W, data: d } = img;
  const L = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  const at = (r, c) => cells[r * g.cols + c];
  const light = (cell) => cell && 0.299 * cell.fill[0] + 0.587 * cell.fill[1] + 0.114 * cell.fill[2] > 170;
  const w = Math.max(1, Math.round(Math.min(...g.pitch) * 0.05));
  const edge = (horizontal, i, j) => { // horizontal: line y = ys[i] between xs[j], xs[j+1]; else line x = xs[i] between ys[j], ys[j+1]
    const v = [];
    for (const f of [0.25, 0.4, 0.5, 0.6, 0.75]) {
      let m = 255;
      for (let o = -w; o <= w; o++) m = Math.min(m, horizontal ? L(g.xs[j] + (g.xs[j + 1] - g.xs[j]) * f, g.ys[i] + o) : L(g.xs[i] + o, g.ys[j] + (g.ys[j + 1] - g.ys[j]) * f));
      v.push(m);
    }
    return v.sort((a, b) => a - b)[2];
  };
  const edges = []; // { v, cellsTouching: [[r,c]...] }
  for (let i = 0; i <= g.rows; i++) for (let j = 0; j < g.cols; j++) {
    const a = i > 0 ? at(i - 1, j) : null, b = i < g.rows ? at(i, j) : null;
    if ((a && !light(a)) || (b && !light(b))) continue;
    edges.push({ v: edge(true, i, j), cells: [a, b].filter(Boolean) });
  }
  for (let i = 0; i <= g.cols; i++) for (let j = 0; j < g.rows; j++) {
    const a = i > 0 ? at(j, i - 1) : null, b = i < g.cols ? at(j, i) : null;
    if ((a && !light(a)) || (b && !light(b))) continue;
    edges.push({ v: edge(false, i, j), cells: [a, b].filter(Boolean) });
  }
  const vals = edges.map((e) => e.v).sort((a, b) => a - b), n = vals.length, minSide = Math.max(3, Math.ceil(n * 0.03));
  let cut = null, gap = 0;
  for (let k = minSide; k <= n - minSide; k++) if (vals[k] - vals[k - 1] > gap) { gap = vals[k] - vals[k - 1]; cut = (vals[k] + vals[k - 1]) / 2; }
  const out = new Set();
  // A real split: a wide gap (≥ 80) and chart outlines that are actually dark (median ≤ 120).
  const darkSide = vals.filter((v) => v < cut);
  if (gap < 80 || darkSide[darkSide.length >> 1] > 120) return { out, cut: null };
  for (const e of edges) if (e.v > cut) for (const c of e.cells) out.add(`${c.r},${c.c}`);
  return { out, cut };
}

export function readCells(img, g) {
  const cells = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    cells.push({ r, c, ...cellFeature(img, g.xs[c], g.xs[c + 1], g.ys[r], g.ys[r + 1]) });
  }
  // Fill groups: nearest group average within 24 RGB units, then two rounds of re-assignment to the
  // nearest average (no chaining, so blurred in-between cells cannot bridge two chart colours).
  let fills = [];
  for (const cell of cells) {
    let f = fills.find((F) => rgbDist(F.rgb, cell.fill) < 24);
    if (!f) fills.push(f = { rgb: [...cell.fill], sum: [0, 0, 0], n: 0 });
    f.n++; for (let k = 0; k < 3; k++) f.sum[k] += cell.fill[k];
    f.rgb = f.sum.map((v) => v / f.n);
  }
  for (let round = 0; round < 2; round++) {
    for (const f of fills) { f.sum = [0, 0, 0]; f.n = 0; }
    for (const cell of cells) {
      let bi = 0; fills.forEach((F, k) => { if (rgbDist(F.rgb, cell.fill) < rgbDist(fills[bi].rgb, cell.fill)) bi = k; });
      cell.fillId = bi; fills[bi].n++; for (let k = 0; k < 3; k++) fills[bi].sum[k] += cell.fill[k];
    }
    for (const f of fills) if (f.n) f.rgb = f.sum.map((v) => v / f.n);
  }
  const keep = fills.map((f, k) => (f.n ? k : -1)).filter((k) => k >= 0);
  for (const cell of cells) cell.fillId = keep.indexOf(cell.fillId);
  fills = keep.map((k) => ({ rgb: fills[k].rgb.map(Math.round), n: fills[k].n }));
  // Glyph groups: plain (ink < 3%), else single-linkage chaining: two inked cells share a glyph
  // when a chain of near neighbours (distance < LINK) joins them. Group mask = mean of members.
  const LINK = 0.2;
  const inked = cells.filter((c) => c.ink >= 0.03);
  const parent = inked.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < inked.length; i++) for (let j = i + 1; j < inked.length; j++) {
    const dd = (maskDist(inked[i].mask, inked[j].mask) + maskDist(inked[j].mask, inked[i].mask)) / 2;
    if (dd < LINK) parent[find(i)] = find(j);
  }
  const glyphs = []; const rootId = new Map();
  for (const cell of cells) if (cell.ink < 0.03) cell.glyphId = -1;
  inked.forEach((cell, i) => {
    const root = find(i);
    if (!rootId.has(root)) { rootId.set(root, glyphs.length); glyphs.push({ mask: new Float32Array(G * G), n: 0 }); }
    const gl = glyphs[rootId.get(root)]; cell.glyphId = rootId.get(root); gl.n++;
    for (let k = 0; k < gl.mask.length; k++) gl.mask[k] += cell.mask[k];
  });
  for (const gl of glyphs) for (let k = 0; k < gl.mask.length; k++) gl.mask[k] /= gl.n;
  // Cells outside the chart (faint background grid) get one class of their own, marked outside.
  const bg = outsideCells(img, g, cells);
  for (const cell of cells) if (bg.out.has(`${cell.r},${cell.c}`)) { cell.outside = true; cell.fillId = -2; cell.glyphId = -1; }
  // Classes and confidence: margin between own class and the nearest other class.
  const classes = [];
  for (const cell of cells) {
    if (cell.outside) {
      let k = classes.findIndex((C) => C.outside);
      if (k < 0) { classes.push({ outside: true, fillId: -2, glyphId: -1, fill: [...cell.fill], n: 0, sample: { r: cell.r, c: cell.c } }); k = classes.length - 1; }
      classes[k].n++; cell.cls = k; continue;
    }
    let k = classes.findIndex((C) => !C.outside && C.fillId === cell.fillId && C.glyphId === cell.glyphId);
    if (k < 0) { classes.push({ fillId: cell.fillId, glyphId: cell.glyphId, fill: fills[cell.fillId].rgb, n: 0, sample: { r: cell.r, c: cell.c } }); k = classes.length - 1; }
    classes[k].n++; cell.cls = k;
  }
  const blank = new Float32Array(G * G);
  const protoMask = (C) => (C.glyphId < 0 ? blank : glyphs[C.glyphId].mask);
  for (const cell of cells) {
    // Outside cells are decided by their outlines, not their look, so they skip the look comparison.
    if (cell.outside) { cell.own = 0; cell.other = Infinity; cell.uncertain = false; continue; }
    const score = (C) => rgbDist(C.fill, cell.fill) / 255 + maskDist(protoMask(C), cell.mask) * 4;
    const own = score(classes[cell.cls]);
    let other = Infinity;
    classes.forEach((C, k) => { if (k !== cell.cls && !C.outside) other = Math.min(other, score(C)); });
    cell.own = own; cell.other = other;
    // Uncertain when the cell is not clearly nearer its own class than the next one, when it is the
    // only cell of its kind, or when "ink" covers most of it (fill guess unreliable).
    cell.uncertain = own > other * 0.35 || cell.ink > 0.6 || classes[cell.cls].n === 1;
  }
  const grid = [];
  for (let r = 0; r < g.rows; r++) grid.push(cells.filter((x) => x.r === r).map((x) => x.cls));
  return { grid, classes, cells, glyphs: glyphs.map((gl) => ({ n: gl.n, mask: gl.mask })), outlineCut: bg.cut };
}

/** Tiny ASCII preview of a glyph mask, for naming classes in a terminal. */
export function maskArt(mask) {
  let s = '';
  for (let y = 0; y < G; y++) { for (let x = 0; x < G; x++) s += mask[y * G + x] > 0.35 ? '#' : '.'; s += '\n'; }
  return s;
}
