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
 *
 * Default (a guide built from the PDF text, e.g. Rebuild): chart steps are taken out and every
 * confirmed chart is placed again, after its chosen step, or in a "Charts" section at the end of the
 * last piece (before its "Finishing" section, if any) when that step can't be found or none was chosen.
 *
 * opts.keepPlaced (saving one chart into an existing, maybe hand-edited guide): chart steps already in
 * the guide stay where they are and only get their rows/title updated; a chart whose step was removed
 * by hand stays out; only the chart `opts.place` (the one just saved) is placed if it isn't there.
 * Steps of charts no longer confirmed are taken out.
 */
export function attachCharts(tree, charts, sizeId = null, opts = {}) {
  const t = JSON.parse(JSON.stringify(tree || { pieces: [] }));
  const ready = (charts || []).filter((c) => c.status === 'confirmed' && c.grid && c.keys);
  const readyIds = new Set(ready.map((c) => c.id));
  const present = new Set();
  for (const p of t.pieces || []) for (const s of p.sections || []) {
    s.blocks = (s.blocks || []).flatMap((b) => {
      if (!b.chart_id) return [b];
      if (!opts.keepPlaced || !readyIds.has(b.chart_id)) return [];
      present.add(b.chart_id);
      const fresh = chartBlock(ready.find((c) => c.id === b.chart_id), sizeId);
      return [{ ...fresh, ...(b.note ? { note: b.note } : {}) }];   // updated in place (a note added in the editor is kept)
    });
  }
  for (const p of t.pieces || []) p.sections = (p.sections || []).filter((s) => !(s.charts_section && !s.blocks.length));
  const toPlace = ready.filter((c) => !present.has(c.id) && (!opts.keepPlaced || c.id === opts.place));
  if (!toPlace.length) return t;
  if (!(t.pieces || []).length) t.pieces = [{ id: 'pcharts', name: 'Charts', sections: [] }];
  const lastAfter = new Map();   // anchor block → last chart put after it (keeps charts in order)
  for (const chart of toPlace) {
    const block = chartBlock(chart, sizeId);
    const at = findPlace(t, chart.place);
    if (at) {
      const blocks = at.section.blocks;
      let after = lastAfter.get(at.block) || at.block;
      // Keep charts that follow the same step in page order, also among ones already there.
      while (blocks[blocks.indexOf(after) + 1] && blocks[blocks.indexOf(after) + 1].chart_id
        && (ready.find((c) => c.id === blocks[blocks.indexOf(after) + 1].chart_id) || {}).page < chart.page) after = blocks[blocks.indexOf(after) + 1];
      blocks.splice(blocks.indexOf(after) + 1, 0, block);
      lastAfter.set(at.block, block);
    } else {
      const piece = t.pieces[t.pieces.length - 1];
      let sec = piece.sections.find((x) => x.charts_section);
      if (!sec) {
        sec = { id: 'scharts', name: 'Charts', charts_section: true, blocks: [] };
        const fin = piece.sections.findIndex((x) => /finish/i.test(x.name || ''));   // before "Finishing", if there is one
        if (fin > 0) piece.sections.splice(fin, 0, sec); else piece.sections.push(sec);
      }
      const i = sec.blocks.findIndex((b) => b.chart_id && (ready.find((c) => c.id === b.chart_id) || {}).page > chart.page);
      if (i >= 0) sec.blocks.splice(i, 0, block); else sec.blocks.push(block);
    }
  }
  return t;
}
