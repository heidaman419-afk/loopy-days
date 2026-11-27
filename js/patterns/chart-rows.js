// A confirmed chart as guide rows (pure, no DOM).
//
// chart = {
//   rot: quarter turns clockwise that make the printed chart upright (as knitted),
//   worked: 'round' | 'flat', first_side: 'RS' | 'WS' (flat only; row 1's side),
//   grid: { rows, cols, cells }  cells in the PRINTED orientation, top row first, key ids,
//   keys: [{ id, name, stitch (library id), colour (0 = main, 1.. = contrast n), none, outside }],
// }
// Rows are numbered from the bottom of the upright chart. In the round every row is read right to
// left; flat, right-side rows are read right to left and wrong-side rows left to right, worked as the
// wrong-side stitch (a knit square is purled, k2tog becomes p2tog, …).

import { symbolById } from './chart-symbols.js';

/** Upright (as knitted) size and cell lookup for a chart. */
export function upright(chart) {
  const R = chart.grid.rows, C = chart.grid.cols, k = ((chart.rot || 0) % 4 + 4) % 4;
  const rows = k % 2 ? C : R, cols = k % 2 ? R : C;
  /** Upright cell (vr from the top, vc from the left) → printed [r, c]. */
  const toPrinted = (vr, vc) => (k === 1 ? [R - 1 - vc, vr] : k === 2 ? [R - 1 - vr, C - 1 - vc] : k === 3 ? [vc, C - 1 - vr] : [vr, vc]);
  /** Printed [r, c] → upright [vr, vc]. */
  const toUpright = (r, c) => (k === 1 ? [c, R - 1 - r] : k === 2 ? [R - 1 - r, C - 1 - c] : k === 3 ? [C - 1 - c, r] : [r, c]);
  const at = (vr, vc) => { const [r, c] = toPrinted(vr, vc); return chart.grid.cells[r][c]; };
  return { rows, cols, at, toPrinted, toUpright };
}

const WS = { k: 'p', p: 'k', ktbl: 'ptbl', ptbl: 'ktbl', k2tog: 'p2tog', p2tog: 'k2tog', ssk: 'ssp', ssp: 'ssk',
  'k2tog tbl': 'p2tog tbl', k3tog: 'p3tog', sssk: 'sssp', 'sl1 wyib': 'sl1 wyif', 'sl1 wyif': 'sl1 wyib' };
export const COLOUR_ABBR = ['MC', 'CC', 'CC2', 'CC3', 'CC4'];

/** Side of chart row n (1-based): '' in the round; flat rows alternate from first_side. */
export function sideOf(chart, n) {
  if (chart.worked !== 'flat') return '';
  const first = chart.first_side === 'WS' ? 'WS' : 'RS';
  return n % 2 ? first : (first === 'RS' ? 'WS' : 'RS');
}

/**
 * Every chart row as { n, side, text, cells, uses, makes }. text is "in words" ("k2 MC, yo MC");
 * cells are key ids in working order (no-stitch and background cells left out); uses/makes count
 * stitches (2-cell symbols count half a made stitch per cell, so a pair makes one).
 */
export function chartRows(chart) {
  const U = upright(chart);
  const keyOf = new Map(chart.keys.map((k) => [k.id, k]));
  const colourCount = new Set(chart.keys.filter((k) => !k.none && !k.outside && k.colour != null).map((k) => k.colour)).size;
  const out = [];
  for (let n = 1; n <= U.rows; n++) {
    const vr = U.rows - n, side = sideOf(chart, n);
    const order = [];
    for (let i = 0; i < U.cols; i++) order.push(U.at(vr, side === 'WS' ? i : U.cols - 1 - i));   // WS: left to right
    const cells = order.filter((id) => { const k = keyOf.get(id); return k && !k.none && !k.outside && k.stitch !== 'none'; });
    let uses = 0, makes = 0;
    for (const id of cells) { const s = symbolById(keyOf.get(id).stitch); uses += s ? s.uses : 1; makes += s ? s.makes : 1; }
    out.push({ n, side, text: inWords(cells, keyOf, side, colourCount > 1), cells, uses: tidy(uses), makes: tidy(makes) });
  }
  return out;
}

const tidy = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : Math.round(v * 10) / 10);

/** Run-length words for one row: "k2 MC, yo MC, k4 MC". */
function inWords(cells, keyOf, side, withColour) {
  const parts = [];
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j < cells.length && cells[j] === cells[i]) j++;
    const k = keyOf.get(cells[i]), s = symbolById(k.stitch), n = j - i;
    const col = withColour && k.colour != null ? ` ${COLOUR_ABBR[k.colour] || `C${k.colour}`}` : '';
    if (!s) parts.push(`${k.name || 'unnamed stitch'}${n > 1 ? ` ×${n}` : ''}`);
    else {
      const abbr = side === 'WS' ? (WS[s.abbr] || s.abbr) : s.abbr;
      const times = s.span ? Math.ceil(n / s.span) : n;           // a 2-cell decrease is one stitch instruction per pair
      if (s.uses === 1 && s.makes === 1 && /^[kp]$/.test(abbr)) parts.push(`${abbr}${times}${col}`);   // k2, p9
      else parts.push(`${abbr}${col}${times > 1 ? ` ×${times}` : ''}`);
    }
    i = j;
  }
  return parts.join(', ');
}
