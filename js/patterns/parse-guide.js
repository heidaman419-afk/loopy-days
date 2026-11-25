// Guide builder (pure): instruction groups from parse-meta.js -> a step-by-step guide
// for one size. A guide is pieces > sections > blocks.
//
// Block kinds:
//   cast_on  { stitches, method, text }
//   rows     { rows: [{ n, side, text, same_as?, all_sizes? }] }
//   repeat   { times, rows: [...] }            (rows worked `times` times)
//   text     { text }                          (anything not understood, finishing notes)
//   bind_off { text }   pick_up { stitches, text }   chart { image_file_id, text }
// Every block: { id, kind, title, note, check, page }

import { pickSize } from './sizes.js';

const ROW = /^(Row|Rnd|Round)s?\s+(\d+)(?:\s*\(\s*(RS|WS)\s*\))?\s*[:.]\s*(.*)$/i;
const ROW_RANGE = /^(Row|Rnd|Round)s\s+(\d+)\s*(?:-|–|to|and)\s*(\d+)(?:\s*\(\s*(RS|WS)\s*\))?\s*[:.]\s*(.*)$/i;
const SAME_AS = /^(?:work|knit|repeat)\s+(?:as\s+(?:for\s+)?)?(?:row|rnd|round)\s+(\d+)\.?$/i;
const REPEAT = /\bwork\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\s+(?:a total of\s+)?(\d+)\s+times\b\.?\s*(.*)$/i;
const REPEAT_MORE = /\b(?:rep(?:eat)?|work)\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\s+(\d+)\s+more\s+times\b\.?\s*(.*)$/i;
const ONCE_MORE = /\bwork\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\b.*\bonce more\b/i;
const CAST_ON = /^(?:cast on|co)\s+(\d+)\s*(?:sts?|stitches)\b\.?\s*(.*)$/i;
const BIND_OFF = /^(?:bind off|bo|cast off)\b/i;
const PICK_UP = /^pick up(?: and knit)?\s+(\d+)\s*(?:sts?|stitches)\b/i;
const FINISH = /^(?:weave in|block\b|blocking|finishing|sew\b|graft\b)/i;
const CHECK = /there (?:are|is) now (?:a total of )?(\d+)\s*(sts?|stitches)([^.]*)\./i;
const METHOD = /(long[- ]tail|cable|backwards?[- ]loop|provisional|german twisted|knitted|tubular|crochet)\s*(?:cast[- ]on|method)?/i;

let seq = 0;
const bid = (prefix) => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** Name a block from the sentence that introduces it. */
export function nameFromIntro(t) {
  if (!t) return '';
  let m = /\blast\s+(\d+)\s+(rows|rounds|rnds)\b/i.exec(t);
  if (m) return `Final ${m[2].toLowerCase() === 'rows' ? 'rows' : 'rounds'}`;
  m = /\b(increase|decrease)s?\b/i.exec(t);
  if (m) return `${cap(m[1].toLowerCase())}s`;
  m = /\b(ribbing|rib|border|edging|yoke|body|sleeves?|collar|heel flap|heel|toe|gusset|cuff|leg|foot|crown|brim|lace|pattern)\b/i.exec(t);
  if (m) return cap(m[1].toLowerCase());
  m = /^(?:now\s+)?work\s+(.{3,30}?)(?:\s+as follows|\s+every|\s+along|:|$)/i.exec(t);
  if (m) return cap(m[1]);
  return cap(t.replace(/[:.]\s*$/, '').slice(0, 40));
}

function stitchCheck(text) {
  const m = CHECK.exec(text || '');
  return m ? `${m[1]} ${m[2].toLowerCase().startsWith('st') && m[2].length <= 3 ? 'sts' : m[2]}${m[3] ? m[3].replace(/\s+/g, ' ') : ''}`.trim() : '';
}

/**
 * groups: instructionGroups from parseMeta (each { heading, lines, page }).
 * opts: { name, sizeIndex, sizeCount }
 */
export function buildGuide(groups, { name = 'Pattern', sizeIndex = 0, sizeCount = 1 } = {}) {
  const sz = (t) => (sizeCount > 1 ? pickSize(t, sizeIndex, sizeCount) : t);
  const piece = { id: bid('p'), name: name || 'Pattern', sections: [] };
  const pieces = [piece];
  let section = null;
  const newSection = (title, page) => { section = { id: bid('s'), name: title, blocks: [], page }; piece.sections.push(section); return section; };

  for (const g of groups) {
    newSection(g.heading || name || 'Pattern', g.page);
    let intro = '';
    let group = null;          // open rows group (a 'rows' block)
    let lastRowsBlock = null;
    const closeGroup = () => { group = null; };

    for (const l of g.lines) {
      const raw = l.text.replace(/\s+/g, ' ').trim();
      const t = sz(raw);
      let m;

      if ((m = ROW.exec(t)) && !ROW_RANGE.test(t)) {
        const n = +m[2];
        if (!group || (group.rows.length && n <= group.rows[group.rows.length - 1].n)) {
          group = { id: bid('b'), kind: 'rows', title: nameFromIntro(intro) || 'Rows', note: intro, check: '', page: l.page, rows: [] };
          section.blocks.push(group);
          lastRowsBlock = group;
          intro = '';
        }
        const row = { n, side: m[3] ? m[3].toUpperCase() : '', text: m[4].trim() };
        if (raw !== t) row.all_sizes = (ROW.exec(raw) || [])[4] || raw;
        const same = SAME_AS.exec(row.text);
        if (same) {
          const ref = group.rows.find((r) => r.n === +same[1]);
          if (ref) { row.same_as = ref.n; row.text = ref.text; }
        }
        const c = stitchCheck(row.text);
        if (c) row.check = c;
        group.rows.push(row);
        continue;
      }

      if ((m = REPEAT.exec(t)) || (m = REPEAT_MORE.exec(t))) {
        const a = +m[1]; const b = +m[2]; let times = +m[3];
        const more = REPEAT_MORE.test(t) && !REPEAT.test(t);
        const target = group || lastRowsBlock;
        if (target && target.rows.some((r) => r.n === a) && target.rows.some((r) => r.n === b)) {
          const inRange = target.rows.filter((r) => r.n >= a && r.n <= b);
          if (more) times += 1; // "repeat rows 1-6 5 more times" = 6 times in all
          target.kind = 'repeat';
          target.rows = inRange;
          target.times = times;
          target.note = [target.note, t].filter(Boolean).join(' ');
          target.check = stitchCheck(t) || target.check;
          if (raw !== t) target.note_all_sizes = raw;
        } else {
          section.blocks.push({ id: bid('b'), kind: 'text', title: 'Repeat', text: t, note: '', check: stitchCheck(t), page: l.page });
        }
        closeGroup();
        continue;
      }

      if ((m = ONCE_MORE.exec(t))) {
        const a = +m[1]; const b = +m[2];
        const src = [...section.blocks].reverse().find((x) => (x.kind === 'rows' || x.kind === 'repeat') && x.rows.some((r) => r.n === a));
        if (src) {
          const blk = {
            id: bid('b'), kind: 'rows', title: `${src.title}: rows ${a}–${b} once more`, note: t, check: '', page: l.page,
            rows: src.rows.filter((r) => r.n >= a && r.n <= b).map((r) => ({ ...r })),
          };
          section.blocks.push(blk);
          lastRowsBlock = blk;
        } else section.blocks.push({ id: bid('b'), kind: 'text', title: 'Note', text: t, note: '', check: '', page: l.page });
        closeGroup();
        continue;
      }

      if ((m = CAST_ON.exec(t))) {
        closeGroup();
        const mm = METHOD.exec(t);
        section.blocks.push({ id: bid('b'), kind: 'cast_on', title: 'Cast on', stitches: +m[1], method: mm ? mm[1].toLowerCase() : '', text: t, note: '', check: '', page: l.page });
        intro = '';
        continue;
      }

      if (PICK_UP.test(t)) {
        closeGroup();
        section.blocks.push({ id: bid('b'), kind: 'pick_up', title: 'Pick up stitches', stitches: +PICK_UP.exec(t)[1], text: t, note: '', check: stitchCheck(t), page: l.page });
        continue;
      }

      if (BIND_OFF.test(t)) {
        closeGroup();
        section.blocks.push({ id: bid('b'), kind: 'bind_off', title: 'Bind off', text: t, note: '', check: '', page: l.page });
        continue;
      }

      if (FINISH.test(t)) {
        closeGroup();
        let fin = piece.sections.find((s) => /^finishing$/i.test(s.name));
        if (!fin) fin = { id: bid('s'), name: 'Finishing', blocks: [], page: l.page };
        if (!piece.sections.includes(fin)) piece.sections.push(fin);
        const last = fin.blocks[fin.blocks.length - 1];
        if (last && last.kind === 'text' && last.title === 'Finishing') last.text += `\n${t}`;
        else fin.blocks.push({ id: bid('b'), kind: 'text', title: 'Finishing', text: t, note: '', check: '', page: l.page });
        continue;
      }

      // Prose: a sentence that leads into rows names the next block; anything else is kept as text.
      closeGroup();
      if (/:\s*$|as follows|follows:/i.test(t)) { intro = t; continue; }
      const c = stitchCheck(t);
      const prev = section.blocks[section.blocks.length - 1];
      if (c && prev && !prev.check) { prev.check = c; continue; }
      section.blocks.push({ id: bid('b'), kind: 'text', title: nameFromIntro(t) || 'Note', text: t, note: '', check: c, page: l.page });
    }
    if (!section.blocks.length) piece.sections.splice(piece.sections.indexOf(section), 1);
  }
  // A single anonymous section named like the piece is fine; drop empty pieces.
  return { pieces: pieces.filter((p) => p.sections.length) };
}
