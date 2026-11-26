// Pure text-layout helpers (no DOM, no pdf.js): turn positioned text items from a PDF
// page into reading-order lines, then join wrapped lines into logical lines.
//
// Input page: { p, w, h, items: [{ s, x, y, fs, w, bold, italic }] }  (y grows upwards, PDF style)
// Output logical line: { page, x, y, fs, text, parts: [{ x, text, bold }], bold, big, gapAbove }

const SPACE = /\s/;

/** Group a page's items into visual lines (top to bottom, left to right). */
export function pageLines(page) {
  const items = page.items.filter((i) => i.s !== '' && i.s != null);
  items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  for (const it of items) {
    const tol = Math.max(2, (it.fs || 10) * 0.3);
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  lines.sort((a, b) => b.y - a.y);
  const out = [];
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    const fs = Math.max(...l.items.map((i) => i.fs || 0));
    // Split into column parts at big horizontal gaps (label column vs value column).
    const parts = [];
    let cur = null;
    let prevEnd = null;
    let text = '';
    let boldChars = 0;
    let chars = 0;
    for (const it of l.items) {
      const gap = prevEnd == null ? 0 : it.x - prevEnd;
      const isSpaceOnly = !it.s.trim();
      if (!cur || (gap > fs * 1.4 && !isSpaceOnly)) {
        if (cur && !isSpaceOnly) { cur.text = cur.text.trim(); parts.push(cur); cur = null; }
        if (!cur && !isSpaceOnly) cur = { x: it.x, text: '', boldChars: 0, chars: 0 };
      }
      if (cur) {
        const needSpace = cur.text && !SPACE.test(cur.text.slice(-1)) && !SPACE.test(it.s[0]) && gap > fs * 0.15;
        cur.text += (needSpace ? ' ' : '') + it.s;
        const n = it.s.replace(/\s/g, '').length;
        cur.chars += n; chars += n;
        if (it.bold) { cur.boldChars += n; boldChars += n; }
      }
      // Spacer items can be very wide (tab stops): they never close a column gap.
      if (!isSpaceOnly) prevEnd = Math.max(prevEnd ?? -Infinity, it.x + (it.w || 0));
      else if (prevEnd == null) prevEnd = it.x;
    }
    if (cur) { cur.text = cur.text.trim(); parts.push(cur); }
    if (!parts.length) continue;
    text = parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const xEnd = Math.max(...l.items.map((i) => i.x + (i.w || 0)));
    out.push({
      page: page.p, y: l.y, x: parts[0].x, xEnd, fs, text,
      parts: parts.map((p) => ({ x: p.x, text: p.text, bold: p.chars > 0 && p.boldChars / p.chars > 0.9 })),
      bold: chars > 0 && boldChars / chars > 0.9,
      pageW: page.w, pageH: page.h,
    });
  }
  return out;
}

// Row labels must start with a capital ("Rnd 1", "German Short Row 3"); a wrapped line that
// happens to begin with "rnd 11.5 cm" is a continuation, not a new row.
const ROW_START = /^(?:[A-Z][\w-]*\s+){0,3}(?:Row|Rows|Rnd|Rnds|Round|Rounds)\s+\d/;
const OTHER_START = /^(?:Cast on|CO\b|Work |Now work|Repeat |Rep |Bind off|BO\b|Pick up|Weave in|Next row|Next rnd|Set-?up|Join\b|Place marker|Continue)/i;
const STRUCT_START = { test: (t) => ROW_START.test(t) || OTHER_START.test(t) };

/** Drop page numbers and rule lines; join wrapped lines into logical lines. */
/** Running headers/footers: the same text (numbers ignored) at the same height on most pages. */
function runningKeys(all) {
  const key = (l) => `${l.text.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}|${Math.round(l.y / 6)}`;
  const pagesOf = new Map();
  for (const l of all) {
    const k = key(l);
    if (!pagesOf.has(k)) pagesOf.set(k, new Set());
    pagesOf.get(k).add(l.page);
  }
  const nPages = new Set(all.map((l) => l.page)).size;
  // Short PDFs (2-4 pages): a line seen on 2+ pages counts too, but only in the top/bottom margin band.
  const inBand = (l) => { const h = l.pageH || 842; return l.y < h * 0.12 || l.y > h * 0.88; };
  const banded = new Set(all.filter(inBand).map(key));
  const keys = new Set();
  for (const [k, s] of pagesOf) {
    if ((s.size >= 3 && s.size >= nPages * 0.5) || (nPages <= 4 && s.size >= 2 && banded.has(k))) keys.add(k);
  }
  return { keys, key };
}

/**
 * The document's ordinary distance between wrapped lines of one paragraph, per font size:
 * the smallest gap that occurs at least 3 times between same-size, same-edge lines.
 */
function linePitch(visual) {
  const gaps = new Map();
  for (const lines of visual) {
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1]; const b = lines[i];
      if (Math.abs(a.fs - b.fs) > 0.5 || Math.abs(a.x - b.x) > 3) continue;
      const g = Math.round((a.y - b.y) * 2) / 2;
      if (g <= 0 || g > a.fs * 2.5) continue;
      const fs = Math.round(a.fs);
      if (!gaps.has(fs)) gaps.set(fs, new Map());
      const m = gaps.get(fs);
      m.set(g, (m.get(g) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [fs, m] of gaps) {
    const common = [...m.entries()].filter(([, n]) => n >= 3).map(([g]) => g).sort((x, y) => x - y);
    if (common.length) out.set(fs, common[0]);
  }
  return out;
}

export function logicalLines(pages) {
  const out = [];
  const visual = pages.map((page) => pageLines(page));
  const run = runningKeys(visual.flat());
  pitch = linePitch(visual);
  for (let pi = 0; pi < pages.length; pi++) {
    const lines = visual[pi].filter((l) =>
      !/^\d{1,3}$/.test(l.text) &&                 // page numbers
      !/^[_\-–—=.·•\s]{5,}$/.test(l.text) &&      // rule lines
      !run.keys.has(run.key(l)));                  // running headers / footers
    let prev = null;
    for (const l of lines) {
      const gap = prev ? prev.y - l.y : Infinity;
      const near = gap < Math.max(l.fs, prev ? prev.fs : 0) * 2.15;
      if (prev && near && isContinuation(prev, l)) {
        joinInto(prev, l);
        continue;
      }
      l.gapAbove = gap;
      out.push(l);
      prev = l;
    }
  }
  // Size of body text: the most common font size by characters.
  const bySize = new Map();
  for (const l of out) bySize.set(l.fs, (bySize.get(l.fs) || 0) + l.text.length);
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  for (const l of out) l.big = l.fs > body * 1.12;
  return out;
}

const ONLY_LABEL = /^\s*only\s+(?:for\s+)?sizes?\b[^:]{0,80}:\s*$/i;
const LIST_ITEM = /^(?:[a-z]\.|\d+\.|[•\-–])\s/;
const ROW_LABEL = /^(?:[A-Z][\w-]*\s+){0,3}(?:Rows?|Rnds?|Rounds?)\s+\d[\d\s,–-]*(?:\s*\((?:RS|WS)\))?\s*:\s*$/;
const GLOSS_START =/^[^\s=]{1,14}(?:\s[^\s=]{1,14})?\s+=\s/;   // "m1l = …": a new glossary entry
let pitch = new Map();                                          // set by logicalLines()

function isContinuation(prev, l) {
  if (l.page !== prev.page) return false;
  const gap = prev.y - l.y;
  const normal = gap < Math.max(l.fs, prev.fs) * 1.95;      // ordinary line spacing, no blank line
  // Plain paragraphs: same font size, not a new "term = …" entry, and not a sentence that ended
  // above a gap clearly bigger than the document's wrapped-line spacing (tight paragraph spacing).
  const p = pitch.get(Math.round(l.fs));
  const newPara = p && gap > p * 1.3 && /[.!:]["”’)]?\s*$/.test(prev.text) && /^[A-Z*(]/.test(l.text);
  const plainOk = Math.abs(l.fs - prev.fs) <= 0.5 && !GLOSS_START.test(l.text) && !newPara;
  const sameX = Math.abs(l.x - prev.x) <= 3;
  const single = prev.parts.length === 1 && l.parts.length === 1;
  // "Only sizes (S, M):" on its own line owns the lines right under it, whatever they are.
  if (ONLY_LABEL.test(prev.text) && gap < Math.max(l.fs, prev.fs) * 2.15 && sameX && single) return true;
  // A sentence cut after a comma, or going on in lower case, continues on the next line
  // even when that line starts with a step word ("…sleeve sts," / "pick up and knit 4 sts.").
  if (!prev.bold && !l.bold && normal && sameX && single && Math.abs(l.fs - prev.fs) <= 0.5 && !GLOSS_START.test(l.text)
    && (/[,;]\s*$/.test(prev.text) || (/[a-z)]\s*$/.test(prev.text) && /^[a-z]/.test(l.text)))) return true;
  if (STRUCT_START.test(l.text) && l.x <= prev.x + 2) return false;
  // A bold label ending in ':' ("Rnd 1:", "Gauge:") owns the plain lines right under it.
  // Row labels on their own line ("Rnd 1:", "Short Row 3 (RS):") may sit a little further up.
  const labelNear = ROW_LABEL.test(prev.text) ? gap < Math.max(l.fs, prev.fs) * 2.15 : normal;
  if (prev.bold && /:\s*$/.test(prev.text) && !l.bold && labelNear && sameX && single && !LIST_ITEM.test(l.text)) return true;
  // Plain lines at ordinary spacing belong to the same paragraph.
  if (!prev.bold && !l.bold && normal && sameX && single && plainOk && !LIST_ITEM.test(l.text)) return true;
  // Indented under the previous line's value column (label/value tables, "Row n:" entries).
  if (prev.parts.length > 1) {
    const valueX = prev.parts[1].x;
    if (Math.abs(l.x - valueX) <= 3 && l.parts.length === 1) return true;
  }
  // Same left edge, previous line ran to (near) the right margin: a wrapped paragraph.
  const width = prev.pageW || 600;
  // (Only plain one-column lines: label/value rows and "Row n:" entries never merge this way.)
  if (prev.parts.length === 1 && l.parts.length === 1 && Math.abs(l.x - prev.x) <= 3
    && prev.xEnd > width * 0.72 && !l.bold && !prev.bold && !STRUCT_START.test(l.text) && plainOk) return true;
  return false;
}

function joinInto(prev, l) {
  const t = prev.text;
  const hyphenJoin = /[A-Za-z]-$/.test(t) && /^[a-z]/.test(l.text);
  prev.text = hyphenJoin ? t + l.text : `${t} ${l.text}`;
  const last = prev.parts[prev.parts.length - 1];
  last.text = hyphenJoin ? last.text + l.text : `${last.text} ${l.text}`;
  prev.bold = prev.bold && l.bold;
  prev.xEnd = l.xEnd;
  prev.y = l.y;
}
