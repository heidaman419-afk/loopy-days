// Guide position maths (pure). One cursor is the truth:
//   cursor = { block_id, pass, rep, row, cast, done }   (pass/rep/row 0-based)
// `pass` is which time a piece is being worked (piece.times, e.g. Sleeves x2).
// Rows done, block status, percentages and the project's main counter all derive from it.
// Blocks without fixed rows (cast on, measure, text, …) count as steps.

/** Rows a block adds to the total (each time its piece is worked). */
export function blockRows(b) {
  if (!b) return 0;
  if (b.kind === 'rows') return (b.rows || []).length;
  if (b.kind === 'repeat') return (b.rows || []).length * Math.max(1, b.times || 1);
  return 0;
}

const passesOf = (piece) => Math.max(1, Math.min(20, parseInt(piece.times, 10) || 1));

/**
 * Every block in working order, pieces repeated as often as they're worked:
 * [{ block, piece, section, pass, passes, index, start, end, rows }]  (start/end 1-based rows)
 */
export function flatten(guide) {
  const out = [];
  let row = 0;
  for (const piece of (guide && guide.pieces) || []) {
    const passes = passesOf(piece);
    for (let pass = 0; pass < passes; pass++) {
      for (const section of piece.sections || []) {
        for (const block of section.blocks || []) {
          const rows = blockRows(block);
          out.push({ block, piece, section, pass, passes, index: out.length, start: rows ? row + 1 : row, end: row + rows, rows });
          row += rows;
        }
      }
    }
  }
  return out;
}

export const totalRows = (guide) => flatten(guide).reduce((n, f) => n + f.rows, 0);
export const totalSteps = (guide) => flatten(guide).filter((f) => !f.rows).length;

export function counts(guide) {
  const pieces = (guide && guide.pieces) || [];
  const sections = pieces.reduce((n, p) => n + (p.sections || []).length, 0);
  const blocks = pieces.reduce((n, p) => n + (p.sections || []).reduce((m, s) => m + (s.blocks || []).length, 0), 0);
  return { pieces: pieces.length, sections, blocks };
}

function find(flat, cursor) {
  if (!cursor) return null;
  const pass = cursor.pass || 0;
  return flat.find((x) => x.block.id === cursor.block_id && x.pass === pass)
    || flat.find((x) => x.block.id === cursor.block_id) || null;
}

/** Make a cursor valid for this guide (block deleted, repeat count lowered, fewer passes, ...). */
export function clamp(guide, cursor) {
  const flat = flatten(guide);
  if (!flat.length) return { block_id: null, pass: 0, rep: 0, row: 0, cast: 0, done: false };
  const f = find(flat, cursor) || flat[0];
  const b = f.block;
  const len = (b.rows || []).length;
  const times = b.kind === 'repeat' ? Math.max(1, b.times || 1) : 1;
  return {
    block_id: b.id,
    pass: f.pass,
    rep: Math.max(0, Math.min(times - 1, (cursor && cursor.rep) || 0)),
    row: len ? Math.max(0, Math.min(len - 1, (cursor && cursor.row) || 0)) : 0,
    cast: Math.max(0, (cursor && cursor.cast) || 0),
    done: !!(cursor && cursor.done),
  };
}

const indexOf = (flat, cursor) => {
  if (cursor && cursor.done) return flat.length;
  const f = find(flat, cursor);
  return f ? f.index : -1;
};

/** Fixed rows done before the cursor (overall, across blocks and passes). */
export function rowsDone(guide, cursor) {
  if (cursor && cursor.done) return totalRows(guide);
  const flat = flatten(guide);
  const f = find(flat, cursor);
  if (!f) return 0;
  const len = (f.block.rows || []).length;
  // A step with fixed rows starts after row start-1; a step without rows (cast on, measure, text…)
  // sits after `end` rows (its start/end both equal the rows worked before it).
  return f.rows ? (f.start - 1) + (cursor.rep || 0) * len + (cursor.row || 0) : f.end;
}

/** Overall progress 0-100: fixed rows and row-less steps both count. */
export function progressPct(guide, cursor) {
  const flat = flatten(guide);
  const total = flat.reduce((n, f) => n + (f.rows || 1), 0);
  if (!total) return 0;
  if (cursor && cursor.done) return 100;
  const i = indexOf(flat, cursor);
  let done = 0;
  for (const f of flat) { if (f.index < i) done += f.rows || 1; }
  const f = flat[i];
  if (f && f.rows) done += (cursor.rep || 0) * (f.block.rows || []).length + (cursor.row || 0);
  return Math.max(0, Math.min(99, Math.round((done / total) * 100)));   // 100 only when finished
}

/** Where the cursor is: { flat entry, row object, rowNumberInBlock, totalInBlock, ... } */
export function locate(guide, cursor) {
  const flat = flatten(guide);
  const f = find(flat, cursor) || flat[0] || null;
  if (!f) return null;
  const b = f.block;
  const rows = b.rows || [];
  const c = cursor || {};
  return {
    ...f,
    rowObj: rows[c.row || 0] || null,
    rowInBlock: rows.length ? (c.row || 0) + 1 : 0,
    rowsInStep: rows.length,
    repeat: b.kind === 'repeat' ? { n: (c.rep || 0) + 1, of: Math.max(1, b.times || 1) } : null,
    patternRow: f.rows ? f.start + (c.rep || 0) * rows.length + (c.row || 0) : null,
    isLast: f.index === flat.length - 1,
  };
}

/**
 * Stitch checks that are true at this place (from locate()): { row, block }.
 * A row check limited to one repeat (row.check_rep) shows only on that repeat. A repeat
 * block's check is the count after the LAST repeat, so it shows only on its final row.
 * scoped: false for guides read before repeat checks carried a scope (no or old reader stamp):
 * their row checks inside repeats can't be trusted on any one pass, so they are not shown.
 * Display only: nothing stored is changed.
 */
export function checksAt(loc, { scoped = true } = {}) {
  if (!loc) return { row: '', block: '' };
  const b = loc.block;
  const r = loc.rowObj;
  const repN = loc.repeat ? loc.repeat.n : 1;
  const trusted = scoped || b.kind !== 'repeat';
  const row = trusted && r && r.check && (!r.check_rep || r.check_rep === repN) ? r.check : '';
  const atEnd = !loc.repeat || (repN === loc.repeat.of && loc.rowInBlock === loc.rowsInStep);
  const block = b && b.check && (b.kind !== 'repeat' || atEnd) ? b.check : '';
  return { row, block: block === row ? '' : block };
}

/**
 * Move forward one step. Rows: next row; end of a repeat: next repeat; end of a block:
 * next block (and it counts as completed). Returns { cursor, completed: blockId|null, finished }.
 */
export function next(guide, cursor) {
  const flat = flatten(guide);
  const c = clamp(guide, cursor);
  const f = find(flat, c);
  if (!f || c.done) return { cursor: c, completed: null, finished: !!c.done };
  const b = f.block;
  const len = (b.rows || []).length;
  const times = b.kind === 'repeat' ? Math.max(1, b.times || 1) : 1;
  if (len && c.row < len - 1) return { cursor: { ...c, row: c.row + 1 }, completed: null, finished: false };
  if (len && c.rep < times - 1) return { cursor: { ...c, rep: c.rep + 1, row: 0 }, completed: null, finished: false };
  if (f.index === flat.length - 1) return { cursor: { ...c, done: true }, completed: b.id, finished: true };
  const n = flat[f.index + 1];
  return { cursor: { block_id: n.block.id, pass: n.pass, rep: 0, row: 0, cast: 0, done: false }, completed: b.id, finished: false };
}

/** Move back one step (into the previous block's last row if needed). Returns { cursor, reopened: blockId|null }. */
export function prev(guide, cursor) {
  const flat = flatten(guide);
  const c = clamp(guide, cursor);
  const f = find(flat, c);
  if (!f) return { cursor: c, reopened: null };
  if (c.done) return { cursor: { ...c, done: false }, reopened: c.block_id };
  const b = f.block;
  const len = (b.rows || []).length;
  if (len && c.row > 0) return { cursor: { ...c, row: c.row - 1 }, reopened: null };
  if (len && c.rep > 0) return { cursor: { ...c, rep: c.rep - 1, row: len - 1 }, reopened: null };
  if (f.index === 0) return { cursor: c, reopened: null };
  const p = flat[f.index - 1];
  const pb = p.block;
  const plen = (pb.rows || []).length;
  const ptimes = pb.kind === 'repeat' ? Math.max(1, pb.times || 1) : 1;
  return { cursor: { block_id: pb.id, pass: p.pass, rep: plen ? ptimes - 1 : 0, row: plen ? plen - 1 : 0, cast: pb.stitches || 0, done: false }, reopened: pb.id };
}

/** Status of a block over all its passes: 'done' | 'current' | 'partial' | 'todo'. */
export function statusOf(guide, cursor, blockId) {
  const flat = flatten(guide);
  const ci = indexOf(flat, cursor);
  const entries = flat.filter((x) => x.block.id === blockId);
  if (!entries.length) return 'todo';
  if (ci < 0) return entries[0].index === 0 ? 'current' : 'todo';
  if (entries.some((x) => x.index === ci)) return 'current';
  if (entries.every((x) => x.index < ci)) return 'done';
  if (entries.some((x) => x.index < ci)) return 'partial';
  return 'todo';
}

/** Rows done inside one block, over all passes (for "Row x of y" in lists). */
export function blockProgress(guide, cursor, blockId) {
  const flat = flatten(guide);
  const st = statusOf(guide, cursor, blockId);
  const entries = flat.filter((x) => x.block.id === blockId);
  if (!entries.length) return { done: 0, of: 0, status: st, passesDone: 0, passes: 1 };
  const ci = indexOf(flat, cursor);
  const of = entries.reduce((n, x) => n + x.rows, 0);
  let done = 0; let passesDone = 0;
  for (const x of entries) {
    if (x.index < ci) { done += x.rows; passesDone++; } else if (x.index === ci && x.rows) {
      done += (cursor.rep || 0) * (x.block.rows || []).length + (cursor.row || 0);
    }
  }
  return { done, of, status: st, passesDone, passes: entries.length };
}

/** Percent for a piece over all its passes (rows-weighted; blocks without rows count as one step). */
export function piecePercent(guide, cursor, piece) {
  let total = 0; let done = 0;
  for (const s of piece.sections || []) {
    for (const b of s.blocks || []) {
      const p = blockProgress(guide, cursor, b.id);
      if (p.of) { total += p.of; done += p.done; } else { total += p.passes; done += p.passesDone; }
    }
  }
  return total ? Math.round((done / total) * 100) : 0;
}

/**
 * Match the steps of an old guide to a new one by what they are, not where they are
 * (a rebuild after steps were moved, renamed, added or deleted by hand). Returns a Map from
 * "<oldBlockId>#<pass>" to "<newBlockId>#<pass>" for steps with a reliable partner only.
 * Always within the same piece and pass, and only when unambiguous:
 *  1. same kind + title + target: paired in order, only if both guides have the same number
 *     of such steps there;
 *  2. otherwise same kind + a non-empty target: only if exactly one such step is left on each side.
 * There is no kind-only fallback: a step without a reliable partner stays unmatched.
 */
export function matchSteps(oldTree, newTree) {
  const oldFlat = flatten(oldTree);
  const newFlat = flatten(newTree);
  const keyOf = (f) => `${f.block.id}#${f.pass}`;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const out = new Map();
  const usedNew = new Set();
  const tiers = [
    { sig: (f) => `${f.block.kind}|${norm(f.block.title)}|${norm(f.block.target)}`, ok: (a, b) => a.length === b.length },
    { sig: (f) => (norm(f.block.target) ? `${f.block.kind}|${norm(f.block.target)}` : null), ok: (a, b) => a.length === 1 && b.length === 1 },
  ];
  for (const { sig, ok } of tiers) {
    const group = (flat, skip) => {
      const m = new Map();
      for (const f of flat) {
        if (skip(f)) continue;
        const s = sig(f);
        if (s == null) continue;
        const k = `${norm(f.piece.name)}|${f.pass}|${s}`;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(f);
      }
      return m;
    };
    const olds = group(oldFlat, (f) => out.has(keyOf(f)));
    const news = group(newFlat, (f) => usedNew.has(keyOf(f)));
    for (const [k, a] of olds) {
      const b = news.get(k) || [];
      if (!b.length || !ok(a, b)) continue;
      a.forEach((f, i) => { out.set(keyOf(f), keyOf(b[i])); usedNew.add(keyOf(b[i])); });
    }
  }
  return out;
}

/** Measured rows that belong to steps of this guide (counts kept aside or for other steps don't count). */
export function measuredRows(tree, measure) {
  const keys = new Set(flatten(tree).map((f) => `${f.block.id}#${f.pass}`));
  return Object.entries(measure || {}).reduce((n, [k, v]) => n + (keys.has(k.includes('#') ? k : `${k}#0`) ? (+v || 0) : 0), 0);
}

/**
 * A project's progress carried from an old guide to a rebuilt one (pure).
 * Measured rows and tallies move only to a step matched by matchSteps(); anything else is
 * kept aside in `unattached` (merged with what an earlier rebuild kept), never given to
 * another step and never counted. The cursor goes to its own step's partner when that step
 * has the same rows; otherwise it keeps the same number of fixed rows done.
 * Returns { cursor, measure, tally, unattached: { measure, tally } }.
 */
export function carryProgress(oldTree, newTree, prog) {
  const pairs = matchSteps(oldTree, newTree);
  const oldFlat = flatten(oldTree);
  const newFlat = flatten(newTree);
  const keyOf = (f) => `${f.block.id}#${f.pass}`;
  const c = (prog && prog.cursor) || {};
  const at = oldFlat.find((f) => f.block.id === c.block_id && f.pass === (c.pass || 0));
  const toKey = at && pairs.get(keyOf(at));
  const to = toKey && newFlat.find((f) => keyOf(f) === toKey);
  const sameRows = to && (to.block.rows || []).length === (at.block.rows || []).length && blockRows(to.block) === blockRows(at.block);
  let cursor;
  if (to && sameRows) cursor = clamp(newTree, { ...c, block_id: to.block.id, pass: to.pass });
  else {
    const rows = rowsDone(oldTree, c);
    cursor = c.done ? { ...clamp(newTree, cursorAtRows(newTree, rows)), done: true } : cursorAtRows(newTree, rows);
  }
  const prev = (prog && prog.unattached) || {};
  const unattached = { measure: { ...(prev.measure || {}) }, tally: { ...(prev.tally || {}) } };
  const move = (obj, kind) => {
    const kept = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const kk = k.includes('#') ? k : `${k}#0`;
      const dest = pairs.get(kk);
      if (dest) kept[dest] = v;
      else if (+v) unattached[kind][kk] = v;
    }
    return kept;
  };
  return { cursor, measure: move(prog && prog.measure, 'measure'), tally: move(prog && prog.tally, 'tally'), unattached };
}

/** Counts a rebuild would leave without a step: { measured, tallies, steps } (for the warning). */
export function unattachedBy(oldTree, newTree, progresses) {
  let measured = 0; let tallies = 0; const steps = new Set();
  for (const p of progresses || []) {
    const r = carryProgress(oldTree, newTree, { ...p, unattached: {} });
    for (const [k, v] of Object.entries(r.unattached.measure)) { measured += +v || 0; steps.add(`${p.id}:${k}`); }
    for (const [k, v] of Object.entries(r.unattached.tally)) { tallies += +v || 0; steps.add(`${p.id}:${k}`); }
  }
  return { measured, tallies, steps: steps.size };
}

/** A cursor at an overall fixed-row position (keeps a project's place when a guide is rebuilt). */
export function cursorAtRows(guide, rows, steps = 0) {
  const flat = flatten(guide);
  if (!flat.length) return clamp(guide, null);
  if (rows <= 0 && steps <= 0) return clamp(guide, null);
  for (const f of flat) {
    if (f.rows && rows < f.end + 1 && rows >= f.start - 1) {
      const off = rows - (f.start - 1);
      const len = (f.block.rows || []).length;
      if (off < f.rows) return { block_id: f.block.id, pass: f.pass, rep: Math.floor(off / len), row: off % len, cast: 0, done: false };
    }
  }
  if (rows >= totalRows(guide)) {
    const last = flat[flat.length - 1];
    return { block_id: last.block.id, pass: last.pass, rep: 0, row: 0, cast: 0, done: false };
  }
  return clamp(guide, null);
}
