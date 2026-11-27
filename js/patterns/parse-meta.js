// Pattern details from logical lines (pure; see parse-lines.js).
// Finds: name, designer, sizes (+ their shape), measurements, gauge, needles/hook, yarns
// (alternatives, and yarns held together), notions, description, glossary (abbreviations),
// read-first notes, and the instruction groups (pieces / sections) for the guide builder.

import { parseSizeList, shapeRegex, defaultShape, toNumber } from './sizes.js';

const LABELS = [
  ['sizes', /^sizes?$/i],
  ['gauge', /^(?:gauge|tension)$/i],
  ['needles', /^(?:needles?|needle sizes?|hooks?|crochet hooks?|suggested needles?)$/i],
  ['materials', /^(?:materials?|yarns?|yarn requirements?|suggested yarns?|yarn suggestions?)$/i],
  ['notions', /^(?:notions?|other materials|you will (?:also )?need|tools)$/i],
  ['measure', /(?:length|width|chest|bust|circumference|measurements?|height|depth|wingspan|size guide)/i],
];

export const INSTRUCTION = /^(?:(?:[A-Z][\w-]*\s+){0,3}(?:Row|Rows|Rnd|Rnds|Round|Rounds)\s+\d|Cast on|CO\s+\d|(?:Now )?work (?:rows?|rnds?|rounds?)\b|Bind off|BO\b|Pick up)/i;
const GLOSSARY_HEAD = /^(?:abbreviations?|glossary|terms|stitch guide|key|explanations?|legend|symbols|chart key|key to (?:the )?(?:charts?|symbols))$/i;
const BACK_MATTER = /©|copyright|all rights reserved|personal,? non-commercial|may not be (?:copied|resold|sold)/i;
const PROMO = /#\w|@\w|www\.|https?:|\.com\b|youtube|instagram|facebook|pinterest|ravelry|newsletter|hope you enjoy|tag me|share your/i;
const KNITTING = /\b(?:cast on|bind off|knit\w*|purl\w*|k\d+|p\d+|k2tog|ssk|rnds?|rows?|sts?|stitch\w*|needles?|markers?|repeat\w*|rib\w*|decrease\w*|increase\w*|measure\w*)\b/i;
/** A short line that is only a link/hashtag/thank-you (long lines with real content are kept). */
const isPromo = (l) => /^#\S+$/.test(l.text.trim()) || (PROMO.test(l.text) && !KNITTING.test(l.text) && l.text.length < 90);

const title = (s) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s)
  ? s.toLowerCase().replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
  : s);

/** Split at a word (" or ", " together with ") at top level only (not inside brackets). */
function splitTop(s, word) {
  const out = [];
  let depth = 0;
  let cur = '';
  const re = new RegExp(`(\\s+${word}\\s+|[()[\\]])`, 'i');
  for (const w of s.split(re)) {
    if (w === '(' || w === '[') depth++;
    if (w === ')' || w === ']') depth = Math.max(0, depth - 1);
    if (new RegExp(`^\\s+${word}\\s+$`, 'i').test(w) && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Yarn weight guessed from stitches per 10 cm / 4 in. */
export function weightFromGauge(sts) {
  if (!sts) return '';
  if (sts >= 33) return 'lace';
  if (sts >= 27) return 'fingering';
  if (sts >= 23) return 'sport';
  if (sts >= 21) return 'dk';
  if (sts >= 16) return 'worsted';
  if (sts >= 12) return 'bulky';
  return 'super_bulky';
}

function parseYarn(text, shape, weight) {
  const y = { id: null, text, name: '', brand: '', weight, grams_text: '', grams: [], skein_grams: null, skein_length: null, skein_unit: 'm', skein_alt: '', length_min: null, length_max: null, length_unit: 'm', skeins_text: '', fibre: '', notes: '', alt: 0, label: '' };
  let rest = text.trim();
  // Amount: "100 (150) 200 g", "450 (475, 500, 525) (550, 575, 600) (625, 650) g" or "300 g"
  const re = shapeRegex(shape);
  const amount = new RegExp(String.raw`^((?:${re ? re.source : '\\d+'})|\d+(?:[.,]\d+)?)\s*(g|gr|grams|oz)\b\.?\s*(?:of\s+)?`, 'i').exec(rest);
  if (amount) {
    y.grams_text = `${amount[1].trim()} ${amount[amount.length - 1]}`;
    const nums = amount[1].match(/\d+(?:[.,]\d+)?/g) || [];
    y.grams = nums.map((n) => toNumber(n));
    rest = rest.slice(amount[0].length);
  } else {
    // Amount at the end: "Cloud Merino by Test Mill (…) 300 (350, 400) g"
    const tail = new RegExp(String.raw`\s((?:${re ? re.source : '\\d+'})|\d+(?:[.,]\d+)?)\s*(g|gr|grams|oz)\b\.?\s*$`, 'i').exec(rest);
    if (tail) {
      y.grams_text = `${tail[1].trim()} ${tail[tail.length - 1]}`;
      y.grams = (tail[1].match(/\d+(?:[.,]\d+)?/g) || []).map((n) => toNumber(n));
      rest = rest.slice(0, tail.index).trim();
    }
  }
  // Put-up: "(50 g = 150 m [164 yds])"
  const pu = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams)\s*=\s*(\d+(?:[.,]\d+)?)\s*(m|yds?|yards|metres|meters)\b\s*(?:\[([^\]]+)\])?\s*\)/i.exec(rest);
  // Put-up: "(100% merino wool - 250 m / 273 yds / 50 g)"
  const pu2 = !pu && /\(\s*([^()]*?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(m|yds?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(m|yds?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*g\s*\)/i.exec(rest);
  if (pu) {
    y.skein_grams = toNumber(pu[1]);
    y.skein_length = toNumber(pu[2]);
    y.skein_unit = /^m/i.test(pu[3]) ? 'm' : 'yd';
    y.skein_alt = pu[4] || '';
    y.notes = pu[0].replace(/^\(\s*|\s*\)$/g, '');
    rest = (rest.slice(0, pu.index) + rest.slice(pu.index + pu[0].length)).trim();
  } else if (pu2) {
    y.fibre = pu2[1].trim();
    y.skein_grams = toNumber(pu2[6]);
    y.skein_length = toNumber(pu2[2]);
    y.skein_unit = /^m/i.test(pu2[3]) ? 'm' : 'yd';
    y.skein_alt = `${pu2[4]} ${pu2[5]}`;
    y.notes = `${pu2[2]} ${pu2[3]} / ${pu2[4]} ${pu2[5]} per ${pu2[6]} g`;
    rest = (rest.slice(0, pu2.index) + rest.slice(pu2.index + pu2[0].length)).trim();
  }
  // "… in color Pearl Gray holding 2 strands together."
  const extra = /\s+(in colou?r\b.*|holding\b.*|held\b.*)$/i.exec(rest);
  if (extra) { y.notes = [y.notes, extra[1].replace(/[.\s]+$/, '')].filter(Boolean).join(' · '); rest = rest.slice(0, extra.index); }
  const by = /^(.*?)\s+(?:by|from)\s+(.+)$/i.exec(rest);
  if (by) { y.name = by[1].trim(); y.brand = by[2].trim().replace(/[.,;]$/, ''); } else y.name = rest.replace(/[.,;]$/, '').trim();
  if (y.grams.length && y.skein_grams && y.skein_length) {
    const len = y.grams.map((g) => Math.round((g / y.skein_grams) * y.skein_length));
    y.length_min = Math.min(...len);
    y.length_max = Math.max(...len);
    y.length_unit = y.skein_unit;
    const sk = y.grams.map((g) => Math.ceil(g / y.skein_grams - 1e-9));
    y.skeins_text = sk.length > 1 ? `${sk[0]} (${sk.slice(1, -1).join(', ')}) ${sk[sk.length - 1]}` : String(sk[0]);
  }
  return y;
}

/** One alternative: a text that may hold several yarns "together with" each other. */
function parseAlternative(text, shape, weight, alt, label) {
  return splitTop(text, 'together with').map((t) => ({ ...parseYarn(t, shape, weight), alt, label }));
}

/** "©Veronika Lindberg from @Kutovakika", "Mette Okkels ©COPYRIGHT 2022", "Design: X". */
function designerFrom(lines) {
  const brandWords = lines.filter((l) => l.page === lines[0].page).map((l) => l.text.toLowerCase().replace(/[^a-z]/g, '')).join(' ');
  for (const l of lines) {
    let m = /^(.+?)\s*©\s*(?:copyright\s*)?(?:\d{4})?/i.exec(l.text);
    if (m && m[1].trim().length > 2 && m[1].trim().length < 60 && !/^©/.test(l.text)) return m[1].trim();
    m = /^©\s*(?:copyright\s*)?(?:\d{4}\s*)?(.{3,80})$/i.exec(l.text.trim());
    if (m) {
      let name = m[1].replace(/\s+(?:from|by|at|via)\s+@.*$/i, '').replace(/\s+@\S+.*$/, '').replace(/\s+\d{4}\b[.,]?\s+(?:all rights|for personal)\b.*$/i, '').replace(/\s+\d{1,4}$/, '').trim();
      // Drop a trailing brand word that also appears elsewhere ("… Kutovakika" with "KUTOVA KIKA" on page 1).
      const words = name.split(/\s+/);
      if (words.length > 2) {
        const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '');
        if (last.length > 4 && brandWords.replace(/\s/g, '').split(last).length > 2) words.pop();
      }
      name = words.join(' ');
      if (name.length > 2) return name;
    }
    m = /^(?:design(?:ed)?\s*(?:by)?|pattern\s+by|by)\s*:?\s+([A-Z][^,|/]{2,50})$/i.exec(l.text);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * pages -> logical lines (from parse-lines.js) -> details.
 * Returns { name, designer, sizes, sizeShape, measurements, gauge, needles, tools, yarns,
 *           notions, description, glossary, notes, instructionGroups, firstInstructionPage }
 */
export function parseMeta(lines) {
  const r = {
    name: '', designer: '', sizes: [], sizeShape: null, measurements: [], gauge: '', needles: '', tools: [], yarns: [],
    notions: '', description: '', glossary: [], notes: [], instructionLines: [], firstInstructionPage: null,
  };
  if (!lines.length) { r.groups = []; r.instructionGroups = []; return r; }
  const labels = {};
  const used = new Set();
  // ---- name: largest text on the first page ----
  const firstPage = Math.min(...lines.map((x) => x.page));
  const first = lines.filter((l) => l.page === firstPage);
  const biggest = first.filter((l) => /[A-Za-z]{2}/.test(l.text)).sort((a, b) => b.fs - a.fs)[0];
  if (biggest) r.name = title(biggest.text.replace(/\s+/g, ' ').trim());

  // ---- label: value lines ----
  for (const l of lines) {
    let lab; let value;
    if (l.parts.length >= 2) {
      if (!/:\s*$/.test(l.parts[0].text) && !l.parts[0].bold) continue;
      lab = l.parts[0].text.replace(/:\s*$/, '').trim();
      value = l.parts.slice(1).map((p) => p.text).join(' ').trim();
    } else {
      // "Sizes: S (M) L" or "a. Bust circumference: 114 (…) cm" on one line; "Suggested yarn:" alone;
      // "Size (EU)" alone as a heading.
      const m = /^(?:[a-z]\.\s+)?([A-Za-z][A-Za-z /]{1,40}):\s*(.*)$/.exec(l.text)
        || ((l.big || l.bold) && /^(?:sizes?|sizing)\s*\([^)]{1,20}\)$/i.exec(l.text) ? [l.text, l.text, ''] : null);
      if (!m || !LABELS.some(([, re]) => re.test(m[1].trim().replace(/\s*\([^)]*\)\s*$/, '')))) continue;
      lab = m[1].trim();
      value = m[2].trim();
    }
    // A label set as a heading on its own line ("Needles:", "Size (EU)"): its value is the
    // body text right under it, up to the next heading-like line.
    if (!value && l.parts.length === 1 && (l.big || l.bold)) {
      const key = LABELS.find(([k, re]) => k !== 'materials' && k !== 'measure' && re.test(lab.replace(/\s*\([^)]*\)\s*$/, '')));
      if (key && !labels[key[0]]) {
        const idx = lines.indexOf(l);
        const below = [];
        for (let k = idx + 1; k < lines.length && lines[k].page === l.page && !lines[k].big && !lines[k].bold; k++) {
          below.push(lines[k]);
          if (key[0] === 'sizes') break;                         // a size list is one line
        }
        if (below.length) {
          labels[key[0]] = { value: below.map((x) => x.text).join(' '), line: l };
          used.add(l);
          below.forEach((x) => used.add(x));
          continue;
        }
      }
    }
    for (const [key, re] of LABELS) {
      if (re.test(lab)) {
        if (key === 'measure') { if (value) r.measurements.push({ label: lab, value }); }
        else if (!labels[key]) labels[key] = { value, line: l };
        used.add(l);
        break;
      }
    }
  }
  const sl = parseSizeList(labels.sizes ? labels.sizes.value : '');
  r.sizes = sl.names;
  r.sizeShape = sl.shape || defaultShape(sl.names.length);
  r.gauge = labels.gauge ? labels.gauge.value : '';
  r.needles = labels.needles ? labels.needles.value : '';
  // "3 mm / US2.5: circular … 4.5 mm / US7: circular …" -> one tool per needle size
  if (r.needles) r.tools.push(...r.needles.split(/(?<=[.;])\s+(?=\d+(?:[.,]\d+)?\s*mm\b)/).map((s) => s.trim()).filter(Boolean));
  r.notions = labels.notions ? labels.notions.value : '';
  if (r.notions) r.tools.push(...r.notions.replace(/\.\s*$/, '').split(/\s*[;,]\s*(?![^(]*\))/).filter(Boolean));
  const sts = /(\d+(?:[.,]\d+)?)\s*(?:sts|stitches)\b/i.exec(r.gauge);
  const weight = weightFromGauge(sts ? toNumber(sts[1]) : 0);

  // ---- yarn ----
  try { readYarn(); } catch (e) { r.yarns = []; console.warn('yarn', e); }
  function readYarn() {
  if (labels.materials) {
    if (labels.materials.value) {
      r.yarns = splitTop(labels.materials.value, 'or').flatMap((t, i) => parseAlternative(t, r.sizeShape, weight, i, ''));
    } else {
      // "Suggested yarn:" followed by "<label> <amount> g …" paragraphs (up to the next heading/page)
      const start = lines.indexOf(labels.materials.line);
      const amountRe = new RegExp(String.raw`^(.{0,40}?):?\s*((?:${shapeRegex(r.sizeShape) ? shapeRegex(r.sizeShape).source : '\\d+'}|\d+(?:[.,]\d+)?)\s*(?:g|gr|grams)\b.*)$`, 'i');
      const amountAny = new RegExp(String.raw`(?:${shapeRegex(r.sizeShape) ? shapeRegex(r.sizeShape).source : '\\d+'})\s*(?:g|gr|grams)\b`, 'i');
      let alt = 0;
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.page !== labels.materials.line.page || (l.bold && l.parts.length === 1 && !/:$/.test(l.text))) break;
        let m = amountRe.exec(l.text);
        // "Gray sample: Cloud Merino by Test Mill (…) 300 (350, 400) g": amount after the yarn
        if (!m && amountAny.test(l.text)) m = /^(.{1,40}?):\s*(.+)$/.exec(l.text);
        if (m && /\d/.test(m[2])) {
          r.yarns.push(...parseAlternative(m[2], r.sizeShape, weight, alt, (m[1] || '').replace(/:$/, '').trim()));
          alt++;
          used.add(l);
        }
      }
    }
  }
  }
  r.yarns.forEach((y, i) => { y.id = `y${i + 1}`; });

  // ---- designer ----
  try { r.designer = designerFrom(lines); } catch (e) { console.warn('designer', e); }

  // ---- split the rest into groups under headings ----
  const isPageTitle = (l) => !l.bold && l.big && l.text === l.text.toUpperCase() && l.text.length <= 30;
  // A heading may end in ':' when it is set bigger than the body text ("Toe:").
  const colonHead = (l) => l.big && l.text.length <= 40 && /^[^.:;]+:$/.test(l.text);
  const isHeading = (l) => l.bold && l.parts.length === 1 && l.text.length <= 70 && (!/[.:;]$/.test(l.text) || colonHead(l)) && !INSTRUCTION.test(l.text) && !PROMO.test(l.text);
  const isPiece = (l) => (l.text === l.text.toUpperCase() && /[A-Z]{3}/.test(l.text)) || l.big;
  const groups = [];
  let g = { heading: null, level: 'section', lines: [], page: null };
  const labelLines = new Set(Object.values(labels).map((x) => x.line));
  for (const l of lines) {
    if (l === biggest || labelLines.has(l) || used.has(l)) continue;
    if (isPageTitle(l)) continue;
    if (/^[↑↓←→⬆⬇]\s*\S{0,15}$/.test(l.text)) continue;                                  // a chart's "↑Start" mark
    if (l.bold && l.parts.length === 1 && PROMO.test(l.text) && !KNITTING.test(l.text)) continue;   // "Watch the video at …"
    if (isHeading(l)) {
      if (g.heading || g.lines.length) groups.push(g);
      // A run-in "Name:" heading names a part of the current piece, not a new piece.
      const piece = isPiece(l) && !colonHead(l);
      const head = l.text.trim().replace(/\s*:$/, '');
      g = { heading: piece ? title(head) : head, level: piece ? 'piece' : 'section', lines: [], page: l.page };
      continue;
    }
    g.lines.push(l);
    if (g.page == null) g.page = l.page;
  }
  if (g.heading || g.lines.length) groups.push(g);

  // ---- classify groups ----
  const instructive = (grp) => grp.lines.some((l) => INSTRUCTION.test(l.text));
  const firstIdx = groups.findIndex(instructive);
  // Pages after the instructions start that hold nothing to knit (thank-you notes, links): drop.
  const instrPages = new Set(lines.filter((l) => INSTRUCTION.test(l.text) || /\buntil\b.*\bmeasure/i.test(l.text) || /^(?:weave in|block\b)/i.test(l.text)).map((l) => l.page));
  const firstInstrPage = firstIdx >= 0 ? groups[firstIdx].page : Infinity;
  const backPage = (p) => p > firstInstrPage && !instrPages.has(p)
    && lines.filter((l) => l.page === p).every((l) => !KNITTING.test(l.text) || PROMO.test(l.text) || BACK_MATTER.test(l.text));
  groups.forEach((grp, i) => {
    if (grp.heading && GLOSSARY_HEAD.test(grp.heading)) {
      // Chart keys: a symbol drawn in text ("/ /", "\\") sits on its own line above its meaning.
      const isSymbol = (l) => !/[A-Za-z0-9]/.test(l.text) && l.text.length <= 16;
      const words = grp.lines.filter((l) => !isSymbol(l));
      const eq = words.filter((l) => /\s?=\s?/.test(l.text)).length >= Math.max(1, words.length * 0.4);
      let symbol = null;
      let prevText = null;
      for (const l of grp.lines) {
        if (BACK_MATTER.test(l.text)) break;
        if (isSymbol(l)) { symbol = l.text.replace(/\s+/g, ' ').trim(); continue; }
        let abbr; let meaning;
        if (eq) {
          const m = /^(.{1,16}?)\s*=\s*(.+)$/.exec(l.text);
          if (m) { abbr = m[1]; meaning = m[2]; }
          else if (symbol) { abbr = symbol; meaning = l.text; }
          else if (r.glossary.length) {
            // A wrapped meaning starts at the same left edge; an indented stray label (a colour
            // swatch's name in a chart key) is not part of it.
            if (!prevText || Math.abs(l.x - prevText.x) <= 3) r.glossary[r.glossary.length - 1].meaning += ` ${l.text}`;
            continue;
          }
          symbol = null;
          prevText = l;
        } else {
          abbr = l.parts.length > 1 ? l.parts[0].text : (/^(\S{1,10}?):?\s+(.+)$/.exec(l.text) || [])[1];
          meaning = l.parts.length > 1 ? l.parts.slice(1).map((p) => p.text).join(' ') : (/^(\S{1,10}?):?\s+(.+)$/.exec(l.text) || [])[2];
        }
        if (abbr && meaning && abbr.replace(/:$/, '').length <= 16) r.glossary.push({ abbr: abbr.replace(/:$/, '').trim(), meaning: meaning.trim() });
      }
      grp.kind = 'glossary';
      return;
    }
    // Copyright / thank-you groups after the instructions are back matter (before them, a
    // © footer line is just skipped from the notes).
    if (grp.lines.some((l) => BACK_MATTER.test(l.text)) && !instructive(grp) && (firstIdx === -1 || i > firstIdx)) { grp.kind = 'back'; return; }
    if (firstIdx === -1 || i < firstIdx) {
      grp.kind = 'notes';
      const keep = grp.lines.filter((l) => !isPromo(l) && !BACK_MATTER.test(l.text));
      const text = keep.map((l) => l.text).join('\n').trim();
      if (grp.heading || text) r.notes.push({ title: grp.heading || '', text });
      // Definitions written as "Kfb: …" also feed the glossary.
      for (const l of grp.lines) {
        if (l.parts.length > 1 && l.parts[0].bold && /:$/.test(l.parts[0].text) && l.parts[0].text.length <= 12) {
          const abbr = l.parts[0].text.replace(/:$/, '').trim();
          if (!r.glossary.some((x) => x.abbr.toLowerCase() === abbr.toLowerCase())) r.glossary.push({ abbr, meaning: l.parts.slice(1).map((p) => p.text).join(' ') });
        } else if (/^(\S{2,8}):\s+(.+)/.test(l.text) && l.parts[0].bold) {
          const m = /^(\S{2,8}):\s+(.+)/.exec(l.text);
          if (!r.glossary.some((x) => x.abbr.toLowerCase() === m[1].toLowerCase())) r.glossary.push({ abbr: m[1], meaning: m[2] });
        }
      }
      return;
    }
    grp.kind = 'instructions';
    grp.lines = grp.lines.filter((l) => !backPage(l.page));
  });
  // The opening paragraphs (before any heading, on the first page they appear) are the description.
  const lead = groups.find((grp) => grp.kind === 'notes' && !grp.heading && grp.lines.some((l) => l.text.length > 60));
  if (lead) {
    const paras = lead.lines.filter((l) => l.text.length > 60 && !PROMO.test(l.text));
    const page = paras.length ? paras[0].page : null;
    const mine = paras.filter((l) => l.page === page);
    r.description = mine.map((l) => l.text).join('\n\n');
    const leadText = lead.lines.map((l) => l.text).join('\n').trim();
    const rest = lead.lines.filter((l) => !mine.includes(l) && !isPromo(l) && !BACK_MATTER.test(l.text));
    const leadKept = lead.lines.filter((l) => !isPromo(l) && !BACK_MATTER.test(l.text)).map((l) => l.text).join('\n').trim();
    r.notes = r.notes.filter((n) => n.title || (n.text !== leadText && n.text !== leadKept));
    if (rest.length && rest.some((l) => l.text.length > 40)) r.notes.unshift({ title: '', text: rest.map((l) => l.text).join('\n') });
  } else {
    const any = lines.find((l) => l.page > firstPage && l.parts.length === 1 && l.text.length > 80 && !INSTRUCTION.test(l.text) && !BACK_MATTER.test(l.text));
    if (any) r.description = any.text;
  }
  r.notes = r.notes.filter((n) => n.title || n.text);
  // One entry per abbreviation (the glossary page's wording wins over earlier mentions).
  const seen = new Map();
  for (const g2 of r.glossary) seen.set(g2.abbr.toLowerCase(), g2);
  r.glossary = [...seen.values()];
  r.groups = groups;
  r.instructionGroups = groups.filter((grp) => grp.kind === 'instructions' && grp.lines.length);
  r.firstInstructionPage = r.instructionGroups[0] ? r.instructionGroups[0].page : null;
  return r;
}
