// Written-out instructions made into the steps a knitter follows (pure; used by buildGuide).
// Only text steps that match these phrasings change; anything else is left exactly as built.
//   1. "Work <stitch> for N rounds: <instruction>."  → a repeat step (<instruction>, N times)
//   2. Several instructions each ending "…, turn."   → short rows (right side / wrong side in turn)
//   3. "<Decrease|Increase> like this on every other round N times."
//        → a repeat of the round from the step before plus a plain round, N times
//   4. "… will be the heel" starts a Heel section (toe, thumb, … too); knitting/picking up stitches
//      along the side of the heel starts a Gusset section.
// The rest of a paragraph stays a text step in its place, so nothing written is lost.

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Sentences of a text (keeps "k1, p1." and quoted words together). */
export function sentences(t) {
  return String(t || '').replace(/\s*\n\s*/g, ' ').split(/(?<=[.!?:])\s+(?=[A-Z«"“(])/).map((x) => x.trim()).filter(Boolean);
}

const REPEAT_WORK = /^work\s+(.{1,40}?)\s+for\s+(\d{1,3})\s+(rounds?|rows?|rnds?)\s*:\s*(.+?)\.?$/i;
const EVERY_OTHER = /^(decrease|increase)s?\b.*?\bon every (?:other|2nd|second|alternate) (rounds?|rows?|rnds?)\s+(\d{1,3}) times\.?$/i;
const PART = /\b(?:will be|is|are|becomes?|form)\s+the\s+(heel|toe|thumb|instep|sole|cuff|yoke|collar|hood|crown)\b/i;
const GUSSET = /\b(?:knit|pick)\s+up\s+\d+\s+(?:sts|stitches)\s+along\s+(?:the\s+)?(?:side|edge)s?\s+of\s+the\s+(?:heel|heel flap|flap)\b/i;
const ROUND_START = /^(?:knit|work|k|p|purl)\b.*\b(?:until|to)\b/i;

/**
 * Refine the steps of every section. `mk` gives fresh ids: mk('b') for a step, mk('s') for a section;
 * `title(text)` makes a short step title; `check(text)` the stitch check a text states ("8 sts left").
 * Reshaped steps keep their original sentence as their text, so nothing written is lost.
 */
export function refineSteps(pieces, { mk, title, check }) {
  for (const piece of pieces) {
    for (const sec of piece.sections) sec.blocks = refineBlocks(sec.blocks, { mk, title, check });
    piece.sections = piece.sections.flatMap((sec) => splitParts(sec, mk));
  }
  return pieces;
}

function textBlock(text, from, { mk, title, check }) {
  return { id: mk('b'), kind: 'text', title: title(text), text, note: '', check: check ? check(text) : '', page: from.page };
}

function refineBlocks(blocks, ctx) {
  const out = [];
  for (const b of blocks) {
    if (b.kind !== 'text' || !b.text) { out.push(b); continue; }
    const ss = sentences(b.text);
    // 1. Work X for N rounds: instruction.
    const m = REPEAT_WORK.exec(ss[0] || '');
    if (m) {
      out.push({ id: b.id, kind: 'repeat', title: cap(m[1].replace(/^(?:in|the)\s+/i, '')), times: +m[2], text: ss[0], note: b.note || '', check: '', page: b.page,
        rows: [{ n: 1, side: '', text: `${m[4].replace(/\.$/, '')}.` }] });
      if (ss.length > 1) out.push(...refineBlocks([textBlock(ss.slice(1).join(' '), b, ctx)], ctx));
      continue;
    }
    // 2. Short rows: two or more instructions ending "turn."
    const turnAt = ss.map((s, i) => (/\bturn\.?$/i.test(s) ? i : -1)).filter((i) => i >= 0);
    if (turnAt.length >= 2) {
      const rows = []; let start = 0;
      for (const i of turnAt) { rows.push(ss.slice(start, i + 1).join(' ').replace(/^continue as follows:\s*/i, '')); start = i + 1; }
      const rsFirst = !/\b(?:on the|from the)\s+(?:ws|wrong side)\b/i.test(rows[0]);
      out.push({ id: b.id, kind: 'rows', title: 'Short rows', text: ss.slice(0, start).join(' '), note: b.note || '', check: '', page: b.page,
        rows: rows.map((text, k) => ({ n: k + 1, side: (k % 2 === 0) === rsFirst ? 'RS' : 'WS', text: cap(text) })) });
      if (start < ss.length) out.push(textBlock(ss.slice(start).join(' '), b, ctx));
      continue;
    }
    // 3. Decrease/increase like this on every other round N times.
    const e = EVERY_OTHER.exec(ss[0] || '');
    const prev = out[out.length - 1];
    if (e && prev && prev.kind === 'text' && prev.text) {
      const ps = sentences(prev.text);
      const at = ps.findIndex((s) => ROUND_START.test(s));
      if (at >= 0) {
        const unit = /row/i.test(e[2]) ? 'row' : 'round';
        const keep = ps.slice(0, at), round = ps.slice(at).join(' ');
        if (keep.length) { prev.text = keep.join(' '); prev.title = ctx.title(prev.text); prev.check = ctx.check ? ctx.check(prev.text) : prev.check; } else out.pop();
        out.push({ id: b.id, kind: 'repeat', title: `${cap(e[1].toLowerCase())}s`, times: +e[3], text: ss[0], note: b.note || '', check: '', page: b.page,
          rows: [{ n: 1, side: '', text: round }, { n: 2, side: '', text: `Work 1 ${unit} plain (no ${e[1].toLowerCase()}s).` }] });
        if (ss.length > 1) out.push(textBlock(ss.slice(1).join(' '), b, ctx));
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

/** 4. A section split where a step names the part it starts (heel, toe, …) or picks up for the gusset. */
function splitParts(sec, mk) {
  const parts = [{ ...sec, blocks: [] }];
  for (const b of sec.blocks) {
    const text = `${b.text || ''} ${(b.rows || []).map((r) => r.text).join(' ')}`;
    const cur = parts[parts.length - 1];
    const part = PART.exec(text);
    let name = part ? cap(part[1].toLowerCase()) : GUSSET.test(text) ? 'Gusset' : null;
    if (name && name.toLowerCase() === String(cur.name).toLowerCase()) name = null;
    if (name && cur.blocks.length) parts.push({ id: mk('s'), name, blocks: [b], page: b.page });
    else cur.blocks.push(b);
  }
  return parts;
}
