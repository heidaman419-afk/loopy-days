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

const STRUCT_START = /^(?:(?:Row|Rows|Rnd|Rnds|Round|Rounds)\s+\d|Cast on|CO\b|Work |Now work|Repeat |Rep |Bind off|BO\b|Pick up|Weave in|Next row|Next rnd|Set-?up|Join\b|Place marker|Continue)/i;

/** Drop page numbers and rule lines; join wrapped lines into logical lines. */
export function logicalLines(pages) {
  const out = [];
  for (const page of pages) {
    const lines = pageLines(page).filter((l) =>
      !/^\d{1,3}$/.test(l.text) &&                 // page numbers
      !/^[_\-–—=.·•\s]{5,}$/.test(l.text));       // rule lines
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

function isContinuation(prev, l) {
  if (l.page !== prev.page) return false;
  if (STRUCT_START.test(l.text) && l.x <= prev.x + 2) return false;
  // Indented under the previous line's value column (label/value tables, "Row n:" entries).
  if (prev.parts.length > 1) {
    const valueX = prev.parts[1].x;
    if (Math.abs(l.x - valueX) <= 3 && l.parts.length === 1) return true;
  }
  // Same left edge, previous line ran to (near) the right margin: a wrapped paragraph.
  const width = prev.pageW || 600;
  // (Only plain one-column lines: label/value rows and "Row n:" entries never merge this way.)
  if (prev.parts.length === 1 && l.parts.length === 1 && Math.abs(l.x - prev.x) <= 3
    && prev.xEnd > width * 0.72 && !l.bold && !prev.bold && !STRUCT_START.test(l.text)) return true;
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
