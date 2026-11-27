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

/**
 * The step a chart most likely belongs after. Candidates: steps that name the chart ("Chart A"), else
 * steps that mention a chart at all. Of those, the nearest one at or before the chart's page (the
 * instruction to work a chart comes just before or on its page); if none, the first candidate.
 */
export function suggestPlace(tree, chart) {
  const all = steps(tree).filter((s) => !s.block.chart_id);
  const name = norm(chart.name);
  let cands = name && name.length > 2 && /\bchart\b/.test(name) ? all.filter((s) => textOf(s.block).includes(name)) : [];
  if (!cands.length) cands = all.filter((s) => /\bchart\b/.test(textOf(s.block)));
  if (!cands.length) return null;
  const pageOf = (st) => +(st.block.page || st.section.page || 0);
  const before = cands.filter((st) => pageOf(st) && chart.page && pageOf(st) <= chart.page);
  // Several on that page: a chart on the same page follows the first mention (it is printed right under
  // its instruction); a chart printed on a later page follows the latest mention before it.
  const top = before.filter((st) => pageOf(st) === Math.max(...before.map(pageOf)));
  const best = top.length ? (pageOf(top[0]) === +chart.page ? top[0] : top[top.length - 1]) : cands[0];
  return placeOf(best.block);
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
      return [{ ...fresh, id: b.id, ...(b.note ? { note: b.note } : {}) }];   // updated in place (its id, and a note added in the editor, kept)
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
  return splitPerPass(t);
}

/**
 * One chart per time worked: a piece worked N times (e.g. "make another slipper") whose step is
 * followed by N different charts in a row (right and left slipper) becomes N pieces, each named after
 * its chart and holding only that chart (other steps, and other charts, are in every copy). The first
 * copy keeps the step ids; later copies get "~2", "~3" … so a knitter's place stays put on Rebuild.
 * A closing "Finishing" section becomes one piece after the copies (it is done once, not per copy).
 */
export function splitPerPass(tree) {
  const out = [];
  for (let piece of tree.pieces || []) {
    const n = Math.max(1, parseInt(piece.times, 10) || 1);
    let run = null;
    if (n > 1) {
      for (const sec of piece.sections || []) {
        for (let i = 0; i < (sec.blocks || []).length && !run; i++) {
          const ids = [];
          for (let j = i; j < sec.blocks.length && sec.blocks[j].chart_id; j++) ids.push(sec.blocks[j].chart_id);
          if (ids.length === n) run = new Set(ids);
        }
      }
    }
    if (!run) { out.push(piece); continue; }
    // A closing "Finishing" section is done once, after all the copies (its own piece).
    const last = piece.sections[piece.sections.length - 1];
    const finishing = piece.sections.length > 1 && last && /finish/i.test(last.name || '') && !last.blocks.some((b) => b.chart_id) ? last : null;
    if (finishing) piece = { ...piece, sections: piece.sections.slice(0, -1) };
    const order = [...run];
    order.forEach((cid, k) => {
      const suffix = k ? `~${k + 1}` : '';
      const copy = JSON.parse(JSON.stringify(piece));
      copy.times = 1;
      copy.id = `${piece.id}${suffix}`;
      for (const sec of copy.sections) {
        sec.id = `${sec.id}${suffix}`;
        sec.blocks = sec.blocks.filter((b) => !(b.chart_id && run.has(b.chart_id) && b.chart_id !== cid))
          .map((b) => (b.chart_id === cid ? b : { ...b, id: `${b.id}${suffix}` }));   // shared steps (charts too) get their own ids
      }
      const chartBlock = copy.sections.flatMap((s) => s.blocks).find((b) => b.chart_id === cid);
      copy.name = chartBlock && chartBlock.title ? chartBlock.title.charAt(0).toUpperCase() + chartBlock.title.slice(1) : `${piece.name} ${k + 1}`;
      copy.per_pass_of = piece.id;
      out.push(copy);
    });
    if (finishing) out.push({ id: `${piece.id}-fin`, name: finishing.name || 'Finishing', times: 1, sections: [finishing] });
  }
  return { ...tree, pieces: out };
}
