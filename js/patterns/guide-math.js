// Guide position maths (pure). One cursor is the truth:
//   cursor = { block_id, rep, row, cast }   (rep/row 0-based inside the block)
// Rows done, block status, percentages and the project's main counter all derive from it.

/** Rows a block adds to the total. */
export function blockRows(b) {
  if (!b) return 0;
  if (b.kind === 'rows') return (b.rows || []).length;
  if (b.kind === 'repeat') return (b.rows || []).length * Math.max(1, b.times || 1);
  return 0;
}

/** Every block in order with its place: [{ block, piece, section, index, start, end, rows }] (start/end 1-based rows). */
export function flatten(guide) {
  const out = [];
  let row = 0;
  for (const piece of (guide && guide.pieces) || []) {
    for (const section of piece.sections || []) {
      for (const block of section.blocks || []) {
        const rows = blockRows(block);
        out.push({ block, piece, section, index: out.length, start: rows ? row + 1 : row, end: row + rows, rows });
        row += rows;
      }
    }
  }
  return out;
}

export const totalRows = (guide) => flatten(guide).reduce((n, f) => n + f.rows, 0);

export function counts(guide) {
  const pieces = (guide && guide.pieces) || [];
  const sections = pieces.reduce((n, p) => n + (p.sections || []).length, 0);
  const blocks = pieces.reduce((n, p) => n + (p.sections || []).reduce((m, s) => m + (s.blocks || []).length, 0), 0);
  return { pieces: pieces.length, sections, blocks };
}

/** Make a cursor valid for this guide (block deleted, repeat count lowered, ...). */
export function clamp(guide, cursor) {
  const flat = flatten(guide);
  if (!flat.length) return { block_id: null, rep: 0, row: 0, cast: 0, done: false };
  let f = cursor && flat.find((x) => x.block.id === cursor.block_id);
  if (!f) f = flat[0];
  const b = f.block;
  const len = (b.rows || []).length;
  const times = b.kind === 'repeat' ? Math.max(1, b.times || 1) : 1;
  return {
    block_id: b.id,
    rep: Math.max(0, Math.min(times - 1, (cursor && cursor.rep) || 0)),
    row: len ? Math.max(0, Math.min(len - 1, (cursor && cursor.row) || 0)) : 0,
    cast: Math.max(0, (cursor && cursor.cast) || 0),
    done: !!(cursor && cursor.done),
  };
}

/** Rows done before the cursor (overall, across blocks). */
export function rowsDone(guide, cursor) {
  if (cursor && cursor.done) return totalRows(guide);
  const flat = flatten(guide);
  const f = flat.find((x) => x.block.id === (cursor && cursor.block_id));
  if (!f) return 0;
  const len = (f.block.rows || []).length;
  return (f.start ? f.start - 1 : f.end) + (f.rows ? (cursor.rep || 0) * len + (cursor.row || 0) : 0);
}

/** Where the cursor is: { flat entry, row object, rowNumberInBlock, totalInBlock } */
export function locate(guide, cursor) {
  const flat = flatten(guide);
  const f = flat.find((x) => x.block.id === (cursor && cursor.block_id)) || flat[0] || null;
  if (!f) return null;
  const b = f.block;
  const rows = b.rows || [];
  return {
    ...f,
    rowObj: rows[cursor.row] || null,
    rowInBlock: rows.length ? cursor.row + 1 : 0,
    rowsInStep: rows.length,
    repeat: b.kind === 'repeat' ? { n: cursor.rep + 1, of: Math.max(1, b.times || 1) } : null,
    patternRow: f.rows ? f.start + (cursor.rep || 0) * rows.length + (cursor.row || 0) : null,
    isLast: f.index === flat.length - 1,
  };
}

/**
 * Move forward one step. Rows: next row; end of a repeat: next repeat; end of a block:
 * next block (and it counts as completed). Returns { cursor, completed: blockId|null, finished }.
 */
export function next(guide, cursor) {
  const flat = flatten(guide);
  const c = clamp(guide, cursor);
  const i = flat.findIndex((x) => x.block.id === c.block_id);
  if (i < 0 || c.done) return { cursor: c, completed: null, finished: !!c.done };
  const b = flat[i].block;
  const len = (b.rows || []).length;
  const times = b.kind === 'repeat' ? Math.max(1, b.times || 1) : 1;
  if (len && c.row < len - 1) return { cursor: { ...c, row: c.row + 1 }, completed: null, finished: false };
  if (len && c.rep < times - 1) return { cursor: { ...c, rep: c.rep + 1, row: 0 }, completed: null, finished: false };
  if (i === flat.length - 1) return { cursor: { ...c, done: true }, completed: b.id, finished: true };
  return { cursor: { block_id: flat[i + 1].block.id, rep: 0, row: 0, cast: 0, done: false }, completed: b.id, finished: false };
}

/** Move back one step (into the previous block's last row if needed). Returns { cursor, reopened: blockId|null }. */
export function prev(guide, cursor) {
  const flat = flatten(guide);
  const c = clamp(guide, cursor);
  const i = flat.findIndex((x) => x.block.id === c.block_id);
  if (i < 0) return { cursor: c, reopened: null };
  if (c.done) return { cursor: { ...c, done: false }, reopened: c.block_id };
  const b = flat[i].block;
  const len = (b.rows || []).length;
  if (len && c.row > 0) return { cursor: { ...c, row: c.row - 1 }, reopened: null };
  if (len && c.rep > 0) return { cursor: { ...c, rep: c.rep - 1, row: len - 1 }, reopened: null };
  if (i === 0) return { cursor: c, reopened: null };
  const pb = flat[i - 1].block;
  const plen = (pb.rows || []).length;
  const ptimes = pb.kind === 'repeat' ? Math.max(1, pb.times || 1) : 1;
  return { cursor: { block_id: pb.id, rep: plen ? ptimes - 1 : 0, row: plen ? plen - 1 : 0, cast: pb.stitches || 0, done: false }, reopened: pb.id };
}

/** Status of each block for a cursor: 'done' | 'current' | 'todo'. */
export function statusOf(guide, cursor, blockId) {
  const flat = flatten(guide);
  const ci = cursor && cursor.done ? flat.length : flat.findIndex((x) => x.block.id === (cursor && cursor.block_id));
  const bi = flat.findIndex((x) => x.block.id === blockId);
  if (bi < 0) return 'todo';
  if (ci < 0) return bi === 0 ? 'current' : 'todo';
  return bi < ci ? 'done' : bi === ci ? 'current' : 'todo';
}

/** Rows done inside one block (for "Row x of y" in lists). */
export function blockProgress(guide, cursor, blockId) {
  const st = statusOf(guide, cursor, blockId);
  const f = flatten(guide).find((x) => x.block.id === blockId);
  if (!f) return { done: 0, of: 0, status: st };
  if (st === 'done') return { done: f.rows, of: f.rows, status: st };
  if (st === 'todo') return { done: 0, of: f.rows, status: st };
  const len = (f.block.rows || []).length;
  return { done: (cursor.rep || 0) * len + (cursor.row || 0), of: f.rows, status: st };
}

/** Percent for a piece (rows-weighted; blocks without rows count as one step). */
export function piecePercent(guide, cursor, piece) {
  let total = 0; let done = 0;
  for (const s of piece.sections || []) {
    for (const b of s.blocks || []) {
      const p = blockProgress(guide, cursor, b.id);
      const w = p.of || 1;
      total += w;
      done += p.of ? p.done : (p.status === 'done' ? 1 : 0);
    }
  }
  return total ? Math.round((done / total) * 100) : 0;
}
