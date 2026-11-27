// Guide builder (pure): instruction groups from parse-meta.js -> a step-by-step guide
// for one size. A guide is pieces > sections > blocks. A piece can be worked several
// times (piece.times, e.g. "Sleeves (x2)").
//
// Block kinds:
//   cast_on  { stitches, method, text }
//   rows     { rows: [{ n, side, text, same_as?, all_sizes?, check?, check_rep? }] }
//            (check_rep: the row's check is true only on that repeat, 1-based)
//   repeat   { times, rows: [...] }            (rows worked `times` times)
//   measure  { target, text, tally_target?, tally_label? }  (work until it measures…; 0 fixed rows)
//   text     { text }                          (anything not understood, finishing notes)
//   bind_off { text, method }   pick_up { stitches, text }   chart { image_file_id, text }
// Every block: { id, kind, title, note, check, page }

import { pickSize, onlySizes, pickInList, headingSizes, subShape, defaultShape } from './sizes.js';

const ROW = /^((?:[A-Z][\w-]*\s+){0,3}?)(Row|Rnd|Round)s?\s+(\d+)(?:\s*\(\s*(RS|WS)\s*\))?\s*[:.]\s*([\s\S]*)$/;
const ROW_RANGE = /^(?:[A-Z][\w-]*\s+){0,3}?(Row|Rnd|Round)s\s+(\d+)\s*(?:-|–|to|and)\s*(\d+)(?:\s*\(\s*(RS|WS)\s*\))?\s*[:.]\s*(.*)$/;
const SAME_AS = /^(?:work|knit|repeat)\s+(?:as\s+(?:for\s+)?)?(?:row|rnd|round)\s+(\d+)\.?$/i;
const REPEAT = /\bwork\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\s*,?\s+(?:a total of\s+)?(\d+)\s+times\b\.?\s*(.*)$/i;
const REPEAT_MORE = /\b(?:rep(?:eat)?|work)\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\s*,?\s+(\d+)\s+more\s+times\b\.?\s*(.*)$/i;
const ONCE_MORE = /\bwork\s+(?:rows?|rnds?|rounds?)\s+(\d+)\s*(?:-|–|to)\s*(\d+)\b.*\bonce more\b/i;
const CAST_ON = /^(?:cast on|co)\s+(\d+)\s*(?:sts?|stitches)\b\.?\s*(.*)$/i;
const BIND_OFF = /^(?:bind off|bo|cast off)\b/i;
const PICK_UP = /\bpick up(?: and knit)?\s+(\d+)\s*(?:sts?|stitches)\b/i;
const FINISH = /^(?:weave in|block\b|blocking|finishing|sew\b|graft\b)/i;
const CHECK = /there (?:are|is) (?:now )?(?:a total of )?(\d+)\s*(sts?|stitches)([^.]*)\./i;
const METHOD = /(long[- ]tail|cable|backwards?[- ]loop|provisional|german twisted|knitted|tubular|crochet)\s*(?:cast[- ]on|method)?/i;
const SAME_WAY = /\bwork (?:the other|a second|the second) (\w+) the same way\b|\bmake (?:a |the )?(?:second|other) (\w+) the same way\b/i;
// "Make another sock." / "Knit one more mitten.": only when the word names the piece or pattern.
const ONE_MORE = /^(?:knit|make|work) (?:one more|another|a second) (\w+)\.?$/i;
const NOTE = /^(?:note|tip|important|hint)\b[^.!:]{0,40}[!:]|^note about\b|^distribution of\b|\bare now complete\b/i;
const MEASURE = /\buntil\b[^.]*?\bmeasure(?:s|d)\b/i;
const TARGET = /until (?:the )?\w+(?: measured(?: [^,.]*?)? is| measures)\s+((?:approx\.?\s*)?[\d.,½¼¾]+\s*(?:cm|mm|in(?:ches)?|["“”″])?(?:\s*\/\s*[\d.,½¼¾]+\s*(?:cm|mm|in(?:ches)?|["“”″]))?)/i;
const AT_SAME_TIME = /while at the same time working (?:an? )?(\w+) (?:rnd|round|row)\s+(.*?)\s+apart\s+(\d+)\s+more times/i;
const ONE_ROUND = /\b(?:work|knit|purl) (?:one|1) (?:\w+ )?(?:rnd|round|row)s?\b/i;
// "Place the sleeve sts on waste yarn …": the step that splits body and sleeves.
const SEPARATE = /^(?:now,?\s+|next,?\s+|then,?\s+)?(?:place|put|transfer|slip|move)\b[^.]*\bsleeves?\b[^.]*\b(?:waste yarn|scrap yarn|holders?|on hold)\b/i;
// (Never a glossary entry such as "k = knit".)
const INSTR = /^\s*\*?\s*(?:(?:k|p)(?:\s*\d+|\s+to\b|\s+all\b|2tog|\b)|sl\b|ssk|yo\b|m1)(?!\w*\s*=\s)/i;
const GENERIC = /^(?:now\s+|next,?\s+)?(?:work|continue)(?:\s+as follows|\s+like this)?\s*:?\s*$/i;
const ONE_ROUND_INTRO = /^(?:and\s+)?work (?:one|1) (?:\w+ )?(?:rnd|round|row)s?(?: as follows)?:?$/i;

let seq = 0;
const bid = (prefix) => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** Name a block from the sentence that introduces it ('' for "Work as follows:"). */
export function nameFromIntro(t) {
  if (!t || GENERIC.test(t.trim())) return '';
  let m = /\blast\s+(\d+)\s+(rows|rounds|rnds)\b/i.exec(t);
  if (m) return `Final ${m[2].toLowerCase() === 'rows' ? 'rows' : 'rounds'}`;
  if (/\braglan\b/i.test(t) && /\bincreas/i.test(t)) return 'Raglan increases';
  m = /\b(increase|decrease)s?\b/i.exec(t);
  if (m) return `${cap(m[1].toLowerCase())}s`;
  m = /\b(ribbing|rib|border|edging|yoke|body|sleeves?|collar|heel flap|heel|toe|gusset|cuff|leg|foot|crown|brim|lace|pattern)\b/i.exec(t);
  if (m) return cap(m[1].toLowerCase());
  m = /^(?:now\s+)?work\s+(.{3,30}?)(?:\s+as follows|\s+every|\s+along|:|$)/i.exec(t);
  if (m) return cap(m[1]);
  return cap(shortTitle(t.replace(/\s*(?:as follows)?\s*[:.]\s*$/i, '')));
}

// Leftover prose: a paragraph that starts with a knitting action starts a step; "Continue …",
// remarks, and whatever follows a lead-in ending in ':' belong to the step before.
const ACTION = /^(?:knit|purl|work|slip|sl|cast|bind|place|put|pick|divide|join|decrease|increase|dec|inc|turn|change|start|begin|cut|break|fold|sew|graft|transfer|move|set|mark|k\d|p\d)\b/i;
const GOES_ON = /^(?:continue|repeat|rep|then|and)\b/i;

/** Group leftover paragraphs into steps: [[para, …], …]. */
function proseSteps(paras) {
  const steps = [];
  for (const p of paras) {
    const cur = steps[steps.length - 1];
    const prev = cur && cur[cur.length - 1];
    // A lead-in to a chart ("… according to the chart:") ends its step: the chart comes next.
    const toChart = prev && /\b(?:charts?|diagrams?)\s*:\s*$/i.test(prev);
    if (cur && !toChart && (/:\s*$/.test(prev) || GOES_ON.test(p) || !ACTION.test(p))) cur.push(p);
    else steps.push([p]);
  }
  return steps;
}

/** "… until there are 8 sts left" / "until you have 50 stitches left": the count to check. */
function proseCheck(t) {
  const m = /\buntil (?:there (?:are|is)|you have) (\d+)\s*(?:sts?|stitches)\s+(left|remain\w*)/gi;
  let last = null;
  for (const x of String(t).matchAll(m)) last = x;
  return last ? `${last[1]} sts ${last[2].toLowerCase()}` : '';
}

function stitchCheck(text) {
  const m = CHECK.exec(text || '');
  return m ? `${m[1]} ${m[2].toLowerCase().startsWith('st') && m[2].length <= 3 ? 'sts' : m[2]}${m[3] ? m[3].replace(/\s+/g, ' ') : ''}`.trim() : '';
}

/** A short title from a sentence: its first clause, cut at a word near 34 characters. */
function shortTitle(t) {
  const first = String(t).split(/[,.;:(!]/)[0].trim();
  if (first.length <= 34) return first;
  return `${first.slice(0, 34).replace(/\s+\S*$/, '')}…`;
}

const isRound = (t) => /\b(?:rnds?|rounds?|in the round)\b/i.test(t);

function roundName(t, inRound = false) {
  const unit = isRound(t) || (inRound && !/\brows?\b/i.test(t)) ? 'round' : 'row';
  if (/transfer[^.]*sleeve|sleeve sts onto a holder|sleeves? on hold/i.test(t)) return 'Separate sleeves';
  if (/decreas|k2tog|ssk|skp/i.test(t)) return `Decrease ${unit}`;
  if (/increas|m1[lr]?|kfb/i.test(t)) return `Increase ${unit}`;
  if (/\b(?:rnd|round|row) of purl|purl (?:one|1) (?:rnd|round|row)/i.test(t)) return `Purl ${unit}`;
  if (/\bknit (?:one|1) (?:rnd|round|row)/i.test(t)) return `Knit ${unit}`;
  return `One ${unit}`;
}

function measureTitle(s, pieceName) {
  const thing = ((/until (?:the )?(\w+)\s+(?:measures|measured)/i.exec(s) || [])[1] || '').toLowerCase();
  const rib = /\brib(?:bing)?\b/i.test(s);
  if (thing === 'ribbing' || thing === 'rib') {
    const p = String(pieceName || '').toLowerCase();
    return /sleeve|arm/.test(p) ? 'Cuff ribbing' : /body|hem/.test(p) ? 'Hem ribbing' : /collar|neck/.test(p) ? 'Collar ribbing' : 'Ribbing';
  }
  if (rib && thing) return `${cap(thing)} ribbing`;
  const same = AT_SAME_TIME.exec(s);
  if (same && thing) return `${cap(thing)} with ${same[1].toLowerCase()}s`;
  if (/stockinette|st st|stocking/i.test(s) && thing) return `${cap(thing)} in stockinette`;
  return thing ? `${cap(thing)} to length` : 'Work to length';
}

/**
 * Version of the PDF guide reader, stamped on guides read from the PDF (guide.reader).
 * Raise it when a change alters what stored guides mean. Guides without a stamp were read
 * before stamping existed (v10/v11 and earlier v12–v15 builds).
 *   2: row checks inside repeats carry their scope (row.check_rep).
 */
export const GUIDE_READER_VERSION = 2;
/** First reader version whose repeat rows carry check scope; older guides get the safe display. */
export const REPEAT_SCOPE_SINCE = 2;

// Stitches each abbreviation adds (+) or removes (-) where it is worked once.
const STITCH_DELTA = { m1: 1, m1l: 1, m1r: 1, m1p: 1, m1lp: 1, m1rp: 1, kfb: 1, pfb: 1, yo: 1,
  k2tog: -1, p2tog: -1, ssk: -1, ssp: -1, skp: -1, sk2p: -2, s2kp: -2, k3tog: -2, p3tog: -2, cdd: -2, sssk: -2 };
const EXPLICIT_DELTA = /(\d+)\s+sts?\s+(increased|decreased)\b/gi;
const EVERY_REP = /\b(?:every|each) (?:repeat|rep|time|pass)\b/i;
const FIRST_REP = /\b(?:first|1st) (?:repeat|rep|time|pass)\b/i;
// Operations known to leave the stitch count unchanged. Anything else is unknown.
const NEUTRAL_OPS = [
  /^[kp](?:\s?\d+)?(?:\s?tbl)?$/,                                                     // k, k1, p 19, k1 tbl
  /^[kp] (?:to (?:the )?(?:end|marker|m|bor-?m|last \d+ sts?)(?: of (?:the )?(?:rnd|round|row))?|all sts?)$/,
  /^(?:pm|sm|rm|place marker|slip marker|remove marker)$/,
  /^sl\s?\d*(?: sts?)?(?: (?:wyif|wyib|pwise|kwise|purlwise|knitwise))?$/,
  /^turn(?: work)?$/,
  /^rep(?:eat)?(?: from)? *(?:to (?:the )?end(?: of (?:the )?(?:rnd|round|row))?)?$/,  // after *…* is taken out
];

/** Net change of a list of operations ("K1, M1L, k to end"), or null if any op is not supported. */
function opsDelta(s) {
  let d = 0;
  for (const raw of s.split(/[,.;:]/)) {
    const op = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!op) continue;
    const key = op.replace(/ ?tbl$/, '');
    if (Object.prototype.hasOwnProperty.call(STITCH_DELTA, key)) { d += STITCH_DELTA[key]; continue; }
    if (NEUTRAL_OPS.some((re) => re.test(op))) continue;
    return null;                                    // unsupported operation or multiplier ("M1 twice", "RLI")
  }
  return d;
}

/**
 * Net stitch change of one row, or null if it can't be accounted for.
 * A stated change ("4 sts increased") wins. Otherwise every operation must be in the small
 * supported list: an unknown stitch or multiplier is never read as zero. A *…* part is worked
 * an unknown number of times, so it must itself be fully supported and balanced (*k2tog, yo*).
 * Notes written as "(=half of back sts)" are ignored; any other bracket is unknown.
 */
export function rowDelta(text) {
  const t = String(text || '');
  const ex = [...t.matchAll(EXPLICIT_DELTA)];
  if (ex.length) return ex.reduce((n, m) => n + (/^inc/i.test(m[2]) ? +m[1] : -m[1]), 0);
  let rest = t.replace(/\(\s*=[^)]*\)/g, ' ');
  if (/[()[\]]/.test(rest)) return null;
  for (const seg of rest.match(/\*[^*]*\*/g) || []) {
    const inner = seg.slice(1, -1).trim();
    if (inner && inner !== '-' && opsDelta(inner) !== 0) return null;
    rest = rest.replace(seg, ' ');
  }
  if (rest.includes('*')) return null;
  return opsDelta(rest);
}

/**
 * A count written under a row of a repeated block ("There are 148 sts" after Rnd 1) describes
 * that row on the first time through. It holds on every pass only if the whole repeat leaves the
 * stitch count unchanged (net 0). Explicit wording ("on every repeat" / "on the first repeat")
 * wins; when the net change can't be told for sure, it is shown on the first pass only.
 * (The block's own check is the count after the last repeat; guide-math shows it on the last row.)
 */
function scopeRepeatChecks(b) {
  if (b.kind !== 'repeat' || !(b.times > 1)) return;
  let net = 0;
  for (const r of b.rows || []) {
    const d = rowDelta(r.text);
    if (d === null) { net = null; break; }
    net += d;
  }
  for (const r of b.rows || []) {
    if (!r.check || EVERY_REP.test(r.check)) continue;
    if (FIRST_REP.test(r.check) || net !== 0) r.check_rep = 1;
  }
}

/**
 * groups: instructionGroups from parseMeta (each { heading, level, lines, page }).
 * opts: { name, sizeIndex, sizeCount, sizeNames, shape }
 */
export function buildGuide(groups, { name = 'Pattern', sizeIndex = 0, sizeCount = 1, sizeNames = null, shape = null } = {}) {
  const sz = (t) => (sizeCount > 1 ? pickSize(t, sizeIndex, sizeCount, shape) : t);
  const myName = sizeNames && sizeNames[sizeIndex];
  let scoped = null;               // the group's heading is for some sizes only: { j, k, shape }
  /** Numbers written for the scoped sizes only ("4 (8) 18 (24)" under "(Sizes I-L only)"). */
  const szScoped = (t) => (scoped && scoped.k > 1 ? pickSize(t, scoped.j, scoped.k, scoped.shape) : t);
  /** Size-specific text: drop "Only sizes …" paragraphs for other sizes, resolve the rest. */
  const prep = (raw) => {
    const only = sizeNames ? onlySizes(raw, sizeNames) : null;
    if (!only) return { t: szScoped(sz(raw)), raw };
    const j = only.sizes.indexOf(myName);
    if (j < 0) return null;
    const body = sz(pickInList(only.body, j, only.sizes.length));
    return { t: body, raw: only.body };
  };

  const pieces = [];
  let piece = null;
  let inRound = false;             // the work has been joined / worked in rounds so far
  let section = null;
  const defaultPiece = () => {
    if (!piece) { piece = { id: bid('p'), name: name || 'Pattern', times: 1, sections: [] }; pieces.push(piece); }
    return piece;
  };
  const newSection = (title, page) => { section = { id: bid('s'), name: title, blocks: [], page }; piece.sections.push(section); return section; };
  const lastInPiece = () => {
    if (!piece) return null;
    for (let i = piece.sections.length - 1; i >= 0; i--) {
      const bl = piece.sections[i].blocks;
      if (bl.length) return bl[bl.length - 1];
    }
    return null;
  };
  const addNote = (b, t) => { b.note = [b.note, t].filter(Boolean).join(' '); };

  for (const g0 of groups) {
    // "Set up (Sizes I-L only)": skipped for other sizes; "(all sizes)" is just dropped from the name.
    const hs = sizeNames && g0.heading ? headingSizes(g0.heading, sizeNames) : null;
    scoped = null;
    if (hs && hs.sizes) {
      if (!hs.sizes.includes(myName)) continue;
      const idx = hs.sizes.map((x) => sizeNames.indexOf(x));
      const k = idx.length;
      const contiguous = idx.every((x, i) => i === 0 || x === idx[i - 1] + 1);
      scoped = { j: hs.sizes.indexOf(myName), k, shape: (contiguous && subShape(shape, idx[0], idx[k - 1])) || defaultShape(k) };
    }
    const g = hs ? { ...g0, heading: hs.name } : g0;
    if (g.level === 'piece') {
      piece = { id: bid('p'), name: g.heading || name || 'Pattern', times: 1, sections: [] };
      pieces.push(piece);
      newSection(g.heading || name || 'Pattern', g.page);
    } else {
      defaultPiece();
      newSection(g.heading || name || 'Pattern', g.page);
    }
    const finishingPiece = /finish/i.test(piece.name);
    let intro = '';
    let pending = [];               // prose waiting for the next step (becomes its note)
    let introAt = 0;                // where the open lead-in sits among the pending prose
    let group = null;               // open rows block
    let lastRowsBlock = null;
    let tentativeCheck = false;     // group.check came from a line that may be followed by more rows
    const closeGroup = () => { group = null; tentativeCheck = false; };
    const takePending = () => { const t = pending.join(' '); pending = []; return t; };
    const push = (b) => { section.blocks.push(b); return b; };
    const oneRound = (introText, body, page) => {
      const all = `${introText || ''} ${body}`;
      return push({
        id: bid('b'), kind: 'rows', title: roundName(all, inRound), check: stitchCheck(body), page,
        note: [takePending(), introText && !GENERIC.test(introText) && !ONE_ROUND_INTRO.test(introText.trim()) ? introText.replace(/:\s*$/, '.') : ''].filter(Boolean).join(' '),
        rows: [{ n: 1, side: '', text: cap(body.trim()) }],
      });
    };
    const measure = (s, page) => {
      const tm = TARGET.exec(s);
      const b = push({
        id: bid('b'), kind: 'measure', title: measureTitle(s, piece.name), target: tm ? tm[1].trim() + (/\bin total\b/i.test(s) ? ' in total' : '') : '',
        text: s.trim(), note: takePending(), check: '', page,
      });
      const same = AT_SAME_TIME.exec(s);
      if (same) {
        b.tally_target = +same[3];
        b.tally_label = `${cap(same[1].toLowerCase())}s done`;
        const ref = [...section.blocks].reverse().find((x) => x !== b && x.kind === 'rows' && new RegExp(same[1].slice(0, 6), 'i').test(x.title));
        addNote(b, `Work a ${same[1].toLowerCase()} round every ${same[2]}, ${same[3]} more times.${ref ? ` ${ref.title}: ${ref.rows[0].text}` : ''}`);
      }
      return b;
    };

    let onlyNext = null;            // an "Only sizes …:" label alone on its line: it owns the next line
    for (const l of g.lines) {
      let text = l.text.replace(/\s+/g, ' ').trim();
      if (onlyNext) { text = `${onlyNext} ${text}`; onlyNext = null; }
      const label = sizeNames ? onlySizes(text, sizeNames) : null;
      if (label && !label.body.trim()) { onlyNext = text; continue; }
      const pr = prep(text);
      if (!pr) continue;                                    // a paragraph for other sizes only
      const { t, raw } = pr;
      if (!t) continue;
      const fromOnly = !!label;
      if (isRound(t)) inRound = true;
      let m;

      if ((m = ROW.exec(t)) && !ROW_RANGE.test(t)) {
        const family = `${m[1]}${m[2]}`.trim();
        const n = +m[3];
        if (!group || group.family !== family || (group.rows.length && n <= group.rows[group.rows.length - 1].n)) {
          const plain = !m[1].trim();
          const ctx = [...pending, intro].join(' ');
          let title = plain ? (/\bplace (?:the |\d+ )?markers?\b/i.test(intro) ? '' : nameFromIntro(intro)) : `${family}s`;
          if (!title && plain && /\bplace (?:the |\d+ )?markers?\b/i.test(intro)) title = `Setup ${m[2].toLowerCase() === 'row' ? 'row' : 'round'}`;
          if (!title && /first (?:rnd|round|row)|markers? (?:are )?placed|set[- ]?up/i.test(ctx)) title = `Setup ${m[2].toLowerCase() === 'row' ? 'row' : 'round'}`;
          if (!title) title = m[2].toLowerCase() === 'row' ? 'Rows' : 'Rounds';
          group = {
            id: bid('b'), kind: 'rows', title, check: '', page: l.page, rows: [], family,
            note: [takePending(), plain && !GENERIC.test(intro) ? intro : ''].filter(Boolean).join(' '),
          };
          section.blocks.push(group);
          lastRowsBlock = group;
          intro = '';
          tentativeCheck = false;
        } else if (tentativeCheck) { group.check = ''; tentativeCheck = false; }
        const row = { n, side: m[4] ? m[4].toUpperCase() : '', text: m[5].trim() };
        if (raw !== t) row.all_sizes = (ROW.exec(raw) || [])[5] || raw;
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
          target.check = stitchCheck(t) || (tentativeCheck ? '' : target.check);
          if (raw !== t) target.note_all_sizes = raw;
        } else {
          section.blocks.push({ id: bid('b'), kind: 'text', title: 'Repeat', text: t, note: takePending(), check: stitchCheck(t), page: l.page });
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
        const extra = [];
        if (/join (?:to work )?in the round/i.test(t)) extra.push('Join to work in the round.');
        if (/beginning of (?:the )?(?:round|rnd)|BOR/i.test(t)) extra.push('Place a marker for the beginning of the round.');
        section.blocks.push({ id: bid('b'), kind: 'cast_on', title: 'Cast on', stitches: +m[1], method: mm ? mm[1].toLowerCase().replace(/-/g, ' ') : '', text: t, note: [takePending(), ...extra].filter(Boolean).join(' '), check: '', page: l.page });
        intro = '';
        continue;
      }

      if ((m = ONE_MORE.exec(t))) {
        const stem = m[1].toLowerCase().replace(/e?s$/, '');
        if (stem.length >= 3 && `${piece.name} ${name}`.toLowerCase().split(/[^a-zà-ÿ]+/).some((w) => w.replace(/e?s$/, '') === stem)) {
          closeGroup();
          piece.times = Math.max(2, piece.times || 1);
          continue;
        }
      }
      if ((m = SAME_WAY.exec(t))) {
        closeGroup();
        piece.times = Math.max(2, piece.times || 1);
        continue;
      }

      if (PICK_UP.test(t)) {
        closeGroup();
        let sum = 0;
        for (const x of t.matchAll(/(?:pick up(?: and knit)?|\bk)\s+(\d+)\s+(?:\w+\s+)?(?:sts?|stitches)\b/gi)) sum += +x[1];
        section.blocks.push({ id: bid('b'), kind: 'pick_up', title: 'Pick up stitches', stitches: sum || +PICK_UP.exec(t)[1], text: t, note: takePending(), check: stitchCheck(t), page: l.page });
        continue;
      }

      if (BIND_OFF.test(t)) {
        closeGroup();
        const mm = /(\w+)\s+bind[- ]?off\s+method/i.exec(t);
        section.blocks.push({ id: bid('b'), kind: 'bind_off', title: 'Bind off', method: mm && !/preferred|your/i.test(mm[1]) ? cap(mm[1].toLowerCase()) : '', text: t, note: takePending(), check: '', page: l.page });
        continue;
      }

      if (FINISH.test(t)) {
        closeGroup();
        if (finishingPiece) {           // a FINISHING piece: every paragraph is its own step
          push({ id: bid('b'), kind: 'text', title: shortTitle(t), text: t, note: takePending(), check: '', page: l.page });
          continue;
        }
        let fin = piece.sections.find((s) => /^finishing$/i.test(s.name));
        if (!fin) fin = { id: bid('s'), name: 'Finishing', blocks: [], page: l.page };
        if (!piece.sections.includes(fin)) piece.sections.push(fin);
        const last = fin.blocks[fin.blocks.length - 1];
        if (last && last.kind === 'text' && last.title === 'Finishing') last.text += `\n${t}`;
        else fin.blocks.push({ id: bid('b'), kind: 'text', title: 'Finishing', text: t, note: '', check: '', page: l.page });
        continue;
      }

      // Notes and tips belong to the step before them (or the next one if there is none yet).
      if (NOTE.test(t)) {
        const prev = lastInPiece();
        if (prev) addNote(prev, t); else pending.push(t);
        continue;
      }

      // "There are 140 sts in total." checks the step before (or the row just worked).
      if (/^there (?:are|is)\b/i.test(t) && stitchCheck(t)) {
        const c = stitchCheck(t);
        if (group) {
          group.rows[group.rows.length - 1].check = c;
          if (!group.check) { group.check = c; tentativeCheck = true; }
          continue;
        }
        const prev = lastInPiece();
        if (prev && !prev.check) prev.check = c;
        else if (prev) addNote(prev, t);
        else pending.push(t);
        continue;
      }

      closeGroup();

      // "Work … until it measures 30 cm" (maybe several sentences: "…. Then work one rnd …").
      if (MEASURE.test(t)) {
        // Split into sentences ("…4 cm. Then purl one rnd. Continue … until 8 cm.").
        for (const s of t.split(/(?<=[.!]["”“]?)\s+(?=(?:Then|Next|Now|After that|Continue|Change|Work|Knit|Purl)\b)/)) {
          const split = /^(.*?\buntil\b.*?)\s+and\s+(work (?:one|1) [^:]*?(?:rnd|round|row)[^:]*):\s*(.+)$/i.exec(s);
          if (split) { measure(split[1], l.page); oneRound(split[2], split[3], l.page); }
          else if (MEASURE.test(s)) measure(s, l.page);
          else if (ONE_ROUND.test(s)) oneRound('', s.replace(/^(?:then|next|now),?\s+/i, ''), l.page);
          else { const prev = lastInPiece(); if (prev) addNote(prev, s); else pending.push(s); }
        }
        continue;
      }

      // "Continue like this: K to marker …" / "Work one rnd as follows: K1, k2tog, …"
      if ((m = /^(.*?(?:as follows|like this|in your chosen size)[^:]*):\s*(\S[\s\S]*)$/i.exec(t)) && INSTR.test(m[2])) {
        oneRound(m[1], m[2], l.page);
        intro = '';
        continue;
      }
      // An instruction on its own after "… as follows:", or the "Only sizes" line kept for this size.
      if (INSTR.test(t) && (intro || fromOnly)) {
        oneRound(intro, t, l.page);
        intro = '';
        continue;
      }
      // "Place the sleeve sts on waste yarn and cast on 6 sts under each arm."
      if (SEPARATE.test(t) && !/sleeve|arm/i.test(piece.name) && !/\bhad on hold\b/i.test(t)) {
        push({ id: bid('b'), kind: 'text', title: 'Separate sleeves', text: t, note: takePending(), check: stitchCheck(t), page: l.page });
        continue;
      }

      // A sentence that leads into rows names the next block. One that led into nothing
      // (another lead-in follows) is kept as prose in its place.
      if (/:\s*$|as follows|follows:/i.test(t)) {
        if (intro) pending.splice(Math.min(introAt, pending.length), 0, intro);
        intro = t;
        introAt = pending.length;
        continue;
      }

      // A short cheer ("Enjoy your new knit!") is a note, not a step.
      if (t.length <= 60 && /!\s*$/.test(t)) {
        const prev = lastInPiece();
        if (prev) addNote(prev, t); else pending.push(t);
        continue;
      }

      if (finishingPiece) { push({ id: bid('b'), kind: 'text', title: shortTitle(t), text: t, note: takePending(), check: '', page: l.page }); continue; }
      pending.push(t);                                       // context for the next step
    }
    // A lead-in that led into nothing stays with the leftover prose, in its place.
    if (intro && pending.length) { pending.splice(Math.min(introAt, pending.length), 0, intro); intro = ''; }
    // Nothing is lost: leftover prose becomes text steps at the end of its part.
    if (pending.length) {
      const steps = proseSteps(pending);
      if (steps.length > 1) {
        // Written-out instructions (no row labels): one step per instruction paragraph.
        for (const ps of steps) {
          const t = ps.join('\n');
          push({ id: bid('b'), kind: 'text', title: nameFromIntro(ps[0]) || shortTitle(ps[0]), text: t, note: '', check: proseCheck(t), page: g.page });
        }
      } else {
        const t = pending.join('\n');
        push({ id: bid('b'), kind: 'text', title: shortTitle(pending[0]), text: t, note: '', check: '', page: g.page });
      }
    }
    if (intro && !section.blocks.length) push({ id: bid('b'), kind: 'text', title: shortTitle(intro), text: intro, note: '', check: '', page: g.page });
    if (!section.blocks.length) piece.sections.splice(piece.sections.indexOf(section), 1);
  }
  for (const p of pieces) for (const s of p.sections) for (const b of s.blocks) { delete b.family; scopeRepeatChecks(b); }
  return { pieces: pieces.filter((p) => p.sections.length) };
}
