// Confirmed charts as steps in a guide (pure, no DOM).
//
// A chart step is an ordinary 'rows' step (or 'repeat' when the chart is worked several times) with
// chart_id set: one row per chart row, its text "in words". So counting, progress, Next/back, the
// editor and Rebuild all treat it like any other step. Its id is derived from the chart id, so a
// knitter's place in it survives Rebuild and re-attaching.
//
// pattern.charts[i] (synced with the pattern): { id, page, name, status: 'confirmed' | 'draft',
//   rot, worked, first_side, grid, keys, times, repeats: { [sizeId|'one']: n },
//   place: { title, text } | null   (the step it follows; null = the "Charts" section at the end) }

import { chartRows } from './chart-rows.js';

export const chartBlockId = (chartId) => `chart-${chartId}`;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const textOf = (b) => norm(`${b.title || ''} ${b.text || ''} ${(b.rows || []).map((r) => r.text).join(' ')} ${b.note || ''}`);

/** The guide step for one chart (rows from the chart; repeats per round for this size, if known). */
export function chartBlock(chart, sizeId = null) {
  const times = Math.max(1, parseInt(chart.times, 10) || 1);
  const rows = chartRows(chart).map((r) => ({ n: r.n, side: r.side, text: r.text || '(no stitches in this row)', chart_row: r.n }));
  const repeats = chart.repeats ? chart.repeats[sizeId || 'one'] : null;
  return {
    id: chartBlockId(chart.id), kind: times > 1 ? 'repeat' : 'rows', ...(times > 1 ? { times } : {}),
    title: chart.name || 'Chart', chart_id: chart.id, text: '', rows,
    ...(repeats ? { repeats: +repeats } : {}),
  };
}

/** Every step of a tree in order, with where it sits: [{ piece, section, block, index }]. */
function steps(tree) {
  const out = [];
  for (const piece of tree.pieces || []) for (const section of piece.sections || []) {
    (section.blocks || []).forEach((block, index) => out.push({ piece, section, block, index }));
  }
  return out;
}

/** The step a chart most likely belongs after: one that names it, else the first that mentions a chart. */
export function suggestPlace(tree, chart) {
  const all = steps(tree).filter((s) => !s.block.chart_id);
  const name = norm(chart.name);
  const named = name && name.length > 2 ? all.find((s) => textOf(s.block).includes(name)) : null;
  const any = named || all.find((s) => /\bchart\b/.test(textOf(s.block)));
  return any ? placeOf(any.block) : null;
}
export const placeOf = (b) => ({ title: b.title || '', text: String(b.text || (b.rows || [])[0]?.text || '').slice(0, 80) });

function findPlace(tree, place) {
  if (!place) return null;
  const all = steps(tree).filter((s) => !s.block.chart_id);
  const t = norm(place.title), x = norm(place.text);
  return all.find((s) => norm(s.block.title) === t && norm(placeOf(s.block).text) === x)
    || (x ? all.find((s) => norm(placeOf(s.block).text) === x) : null)
    || (t ? all.find((s) => norm(s.block.title) === t) : null) || null;
}

/**
 * Put the pattern's confirmed charts into a guide tree (returns a new tree; the input is not changed).
 * Existing chart steps are taken out first, so attaching again never duplicates. A chart goes after
 * its chosen step; if that step can't be found (or none was chosen) it goes in a "Charts" section
 * at the end of the last piece (before its "Finishing" section, if any).
 */
export function attachCharts(tree, charts, sizeId = null) {
  const t = JSON.parse(JSON.stringify(tree || { pieces: [] }));
  for (const p of t.pieces || []) for (const s of p.sections || []) s.blocks = (s.blocks || []).filter((b) => !b.chart_id);
  for (const p of t.pieces || []) p.sections = (p.sections || []).filter((s) => !(s.charts_section && !s.blocks.length));
  const ready = (charts || []).filter((c) => c.status === 'confirmed' && c.grid && c.keys);
  if (!ready.length) return t;
  if (!(t.pieces || []).length) t.pieces = [{ id: 'pcharts', name: 'Charts', sections: [] }];
  const lastAfter = new Map();   // anchor block → last chart put after it (keeps charts in order)
  for (const chart of ready) {
    const block = chartBlock(chart, sizeId);
    const at = findPlace(t, chart.place);
    if (at) {
      const after = lastAfter.get(at.block) || at.block;
      const blocks = at.section.blocks;
      blocks.splice(blocks.indexOf(after) + 1, 0, block);
      lastAfter.set(at.block, block);
    } else {
      const piece = t.pieces[t.pieces.length - 1];
      let sec = piece.sections.find((s) => s.charts_section);
      if (!sec) {
        sec = { id: 'scharts', name: 'Charts', charts_section: true, blocks: [] };
        const fin = piece.sections.findIndex((x) => /finish/i.test(x.name || ''));   // before "Finishing", if there is one
        if (fin > 0) piece.sections.splice(fin, 0, sec); else piece.sections.push(sec);
      }
      sec.blocks.push(block);
    }
  }
  return t;
}
