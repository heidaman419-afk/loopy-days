// Pattern details from logical lines (pure; see parse-lines.js).
// Finds: name, designer, sizes, measurements, gauge, needles/hook, yarns, notions,
// description, glossary (abbreviations), read-first notes, and which lines are the
// knitting instructions (for the guide builder).

import { parseSizes, groupRegex, toNumber } from './sizes.js';

const LABELS = [
  ['sizes', /^sizes?$/i],
  ['gauge', /^(?:gauge|tension)$/i],
  ['needles', /^(?:needles?|needle sizes?|hooks?|crochet hooks?|suggested needles?)$/i],
  ['materials', /^(?:materials?|yarns?|yarn requirements?)$/i],
  ['notions', /^(?:notions?|other materials|you will (?:also )?need|tools)$/i],
  ['measure', /(?:length|width|chest|bust|circumference|measurements?|height|depth|wingspan|size guide)/i],
];

export const INSTRUCTION = /^(?:(?:Row|Rows|Rnd|Rnds|Round|Rounds)\s+\d|Cast on|CO\s+\d|(?:Now )?work (?:rows?|rnds?|rounds?)\b|Bind off|BO\b|Pick up)/i;
const GLOSSARY_HEAD = /^(?:abbreviations?|glossary|terms|stitch guide|key)$/i;
const BACK_MATTER = /©|copyright|all rights reserved|personal,? non-commercial|may not be (?:copied|resold|sold)/i;

const title = (s) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s)
  ? s.toLowerCase().replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
  : s);

/** Split "a or b" at top level only (not inside brackets). */
function splitOr(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  const words = s.split(/(\s+or\s+|[()[\]])/i);
  for (const w of words) {
    if (w === '(' || w === '[') depth++;
    if (w === ')' || w === ']') depth = Math.max(0, depth - 1);
    if (/^\s+or\s+$/i.test(w) && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
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

function parseYarn(text, nSizes, weight) {
  const y = { id: null, text, name: '', brand: '', weight, grams_text: '', grams: [], skein_grams: null, skein_length: null, skein_unit: 'm', skein_alt: '', length_min: null, length_max: null, length_unit: 'm', skeins_text: '', fibre: '', notes: '' };
  let rest = text.trim();
  // Amount: "100 (150) 200 g" or "300 g"
  const re = groupRegex(nSizes);
  const amount = new RegExp(String.raw`^((?:${re ? re.source : '\\d+'})|\d+(?:[.,]\d+)?)\s*(g|gr|grams|oz)\b\.?\s*(?:of\s+)?`, 'i').exec(rest);
  if (amount) {
    y.grams_text = `${amount[1].trim()} ${amount[amount.length - 1]}`;
    const nums = amount[1].match(/\d+(?:[.,]\d+)?/g) || [];
    y.grams = nums.map((n) => toNumber(n));
    rest = rest.slice(amount[0].length);
  }
  // Put-up: "(50 g = 150 m [164 yds])"
  const pu = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams)\s*=\s*(\d+(?:[.,]\d+)?)\s*(m|yds?|yards|metres|meters)\b\s*(?:\[([^\]]+)\])?\s*\)/i.exec(rest);
  if (pu) {
    y.skein_grams = toNumber(pu[1]);
    y.skein_length = toNumber(pu[2]);
    y.skein_unit = /^m/i.test(pu[3]) ? 'm' : 'yd';
    y.skein_alt = pu[4] || '';
    y.notes = pu[0].replace(/^\(\s*|\s*\)$/g, '');
    rest = (rest.slice(0, pu.index) + rest.slice(pu.index + pu[0].length)).trim();
  }
  const by = /^(.*?)\s+(?:by|from)\s+(.+)$/i.exec(rest);
  if (by) { y.name = by[1].trim(); y.brand = by[2].trim(); } else y.name = rest.replace(/[.,;]$/, '').trim();
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

/**
 * pages -> logical lines (from parse-lines.js) -> details.
 * Returns { name, designer, sizes, measurements, gauge, needles, tools, yarns, notions,
 *           description, glossary, notes, instructionLines, firstInstructionPage }
 */
export function parseMeta(lines) {
  const r = {
    name: '', designer: '', sizes: [], measurements: [], gauge: '', needles: '', tools: [], yarns: [],
    notions: '', description: '', glossary: [], notes: [], instructionLines: [], firstInstructionPage: null,
  };
  const labels = {};
  // ---- name: largest text on the first page ----
  const first = lines.filter((l) => l.page === Math.min(...lines.map((x) => x.page)));
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
      // "Sizes: S (M) L" on one line (no column gap)
      const m = /^([A-Za-z][A-Za-z /]{1,30}):\s+(.+)$/.exec(l.text);
      if (!m || !LABELS.some(([, re]) => re.test(m[1].trim()))) continue;
      lab = m[1].trim();
      value = m[2].trim();
    }
    for (const [key, re] of LABELS) {
      if (re.test(lab)) {
        if (key === 'measure') r.measurements.push({ label: lab, value });
        else if (!labels[key]) labels[key] = { value, line: l };
        break;
      }
    }
  }
  r.sizes = parseSizes(labels.sizes ? labels.sizes.value : '');
  r.gauge = labels.gauge ? labels.gauge.value : '';
  r.needles = labels.needles ? labels.needles.value : '';
  if (r.needles) r.tools.push(r.needles);
  r.notions = labels.notions ? labels.notions.value : '';
  if (r.notions) r.tools.push(...r.notions.split(/\s*[;,]\s*(?![^(]*\))/).filter(Boolean));
  const sts = /(\d+(?:[.,]\d+)?)\s*(?:sts|stitches)\b/i.exec(r.gauge);
  const weight = weightFromGauge(sts ? toNumber(sts[1]) : 0);
  if (labels.materials) {
    r.yarns = splitOr(labels.materials.value).map((t, i) => ({ ...parseYarn(t, r.sizes.length, weight), id: `y${i + 1}` }));
  }

  // ---- designer ----
  for (const l of lines) {
    const c = /^(.+?)\s*©\s*(?:copyright\s*)?(?:\d{4})?/i.exec(l.text) || /^(.+?)\s+copyright\s+\d{4}/i.exec(l.text);
    if (c && c[1].trim().length > 2 && c[1].trim().length < 60) { r.designer = c[1].trim(); break; }
    const by = /^(?:design(?:ed)?\s*(?:by)?|pattern\s+by|by)\s*:?\s+([A-Z][^,|/]{2,50})$/i.exec(l.text);
    if (by) { r.designer = by[1].trim(); break; }
  }

  // ---- split the rest into groups under headings ----
  const isHeading = (l) => l.bold && l.parts.length === 1 && l.text.length <= 70 && !/[.:;]$/.test(l.text) && !INSTRUCTION.test(l.text);
  const isPageTitle = (l) => !l.bold && l.big && l.text === l.text.toUpperCase() && l.text.length <= 30;
  const groups = [];
  let g = { heading: null, lines: [], page: null };
  const labelLines = new Set(Object.values(labels).map((x) => x.line));
  for (const l of lines) {
    if (l === biggest || labelLines.has(l) || r.measurements.some((m) => m.label === l.parts[0].text.replace(/:\s*$/, ''))) continue;
    if (isPageTitle(l)) continue;
    if (isHeading(l)) {
      if (g.heading || g.lines.length) groups.push(g);
      g = { heading: l.text.trim(), lines: [], page: l.page };
      continue;
    }
    g.lines.push(l);
    if (g.page == null) g.page = l.page;
  }
  if (g.heading || g.lines.length) groups.push(g);

  // ---- classify groups ----
  const instructive = (grp) => grp.lines.some((l) => INSTRUCTION.test(l.text));
  const firstIdx = groups.findIndex(instructive);
  groups.forEach((grp, i) => {
    if (grp.heading && GLOSSARY_HEAD.test(grp.heading)) {
      for (const l of grp.lines) {
        if (BACK_MATTER.test(l.text)) break;
        const abbr = l.parts.length > 1 ? l.parts[0].text : (/^(\S{1,10}?):?\s+(.+)$/.exec(l.text) || [])[1];
        const meaning = l.parts.length > 1 ? l.parts.slice(1).map((p) => p.text).join(' ') : (/^(\S{1,10}?):?\s+(.+)$/.exec(l.text) || [])[2];
        if (abbr && meaning && abbr.replace(/:$/, '').length <= 10) r.glossary.push({ abbr: abbr.replace(/:$/, '').trim(), meaning: meaning.trim() });
      }
      grp.kind = 'glossary';
      return;
    }
    if (grp.lines.some((l) => BACK_MATTER.test(l.text)) && !instructive(grp)) { grp.kind = 'back'; return; }
    if (firstIdx === -1 || i < firstIdx) {
      grp.kind = 'notes';
      const text = grp.lines.map((l) => l.text).join('\n').trim();
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
  });
  // The opening paragraph (before any heading) is the description; keep it out of the notes.
  const lead = groups.find((grp) => grp.kind === 'notes' && !grp.heading && grp.lines.some((l) => l.text.length > 60));
  if (lead) {
    const para = lead.lines.find((l) => l.text.length > 60);
    r.description = para.text;
    r.notes = r.notes.filter((n) => n.title || n.text !== lead.lines.map((l) => l.text).join('\n').trim());
  } else {
    const any = lines.find((l) => l.page > (first[0] ? first[0].page : 1) && l.parts.length === 1 && l.text.length > 80 && !INSTRUCTION.test(l.text) && !BACK_MATTER.test(l.text));
    if (any) r.description = any.text;
  }
  // One entry per abbreviation (the glossary page's wording wins over earlier mentions).
  const seen = new Map();
  for (const g2 of r.glossary) seen.set(g2.abbr.toLowerCase(), g2);
  r.glossary = [...seen.values()];
  r.groups = groups;
  r.instructionGroups = groups.filter((grp) => grp.kind === 'instructions');
  r.firstInstructionPage = r.instructionGroups[0] ? r.instructionGroups[0].page : null;
  return r;
}
