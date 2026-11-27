// Sizes in pattern text (pure functions).
//
// A pattern lists its sizes once, e.g. "S (M) L" or "XS (S, M, L) (XL, 2XL, 3XL) (4XL, 5XL)".
// That list has a SHAPE: a row of tokens, each either one size outside brackets ('o') or a
// bracketed group of k sizes ({ b: k }). Every number that changes by size is written in the
// same shape ("6 (6) 6", "96 (100, 100, 104) (104, 108, 108) (112, 112)"). Picking a size
// replaces every such group with the number at that size's position.
// Long lists may also be split into comma-separated runs ("A (B) C (D), E (F) G (H)"): the
// shape then holds ',' entries where the commas sit, and numbers may carry a comma there.

const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:\s?[¼½¾⅓⅔⅛])?|[¼½¾⅓⅔⅛])`;
const TOKEN = /^[A-Za-z0-9/½¼¾.+\-]{1,8}$/;

/**
 * Read a size list. Returns { names, shape }.
 * "S (M) L (here …)" -> names S,M,L shape [o, b1, o]; "XS (S, M) L" -> [o, b2, o];
 * "XS (S, M, L) (XL, 2XL, 3XL) (4XL, 5XL)" -> [o, b3, b3, b2]; "S, M, L" -> no shape.
 */
export function parseSizeList(value) {
  const v = String(value || '').trim().replace(/\s*[.;:]$/, '');
  const names = [];
  const shape = [];
  let i = 0;
  while (i < v.length) {
    while (i < v.length && /\s/.test(v[i])) i++;
    if (i >= v.length) break;
    // A comma between runs of a bracketed list: "A (B) C (D), E (F)".
    if (v[i] === ',' && shape.some((t) => t !== 'o' && t !== ',') && shape[shape.length - 1] !== ',' && /^,\s*[^\s(),]/.test(v.slice(i))) {
      shape.push(',');
      i++;
      continue;
    }
    if (v[i] === '(') {
      const end = v.indexOf(')', i);
      if (end < 0) break;
      const inner = v.slice(i + 1, end).split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
      if (!inner.length || !inner.every((s) => TOKEN.test(s))) break;      // "(here the largest size is shown)"
      names.push(...inner);
      shape.push({ b: inner.length });
      i = end + 1;
    } else {
      const m = /^[^\s(),]+/.exec(v.slice(i));
      if (!m || !TOKEN.test(m[0]) || (names.length && /^[a-z]{3,}$/.test(m[0]))) break;
      names.push(m[0]);
      shape.push('o');
      i += m[0].length;
      if (v[i] === ',' && !shape.some((t) => t !== 'o' && t !== ',')) break;   // a plain comma list
    }
  }
  while (shape[shape.length - 1] === ',') shape.pop();
  if (names.length > 1 && shape.some((t) => t !== 'o' && t !== ',')) return { names, shape };
  // comma / slash lists
  const list = v.split(/\s*[,/]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  if (list.length > 1 && list.every((s) => TOKEN.test(s))) return { names: list, shape: null };
  if (TOKEN.test(v)) return { names: [v], shape: null };
  return { names: [], shape: null };
}

/** Old API: just the names. */
export const parseSizes = (value) => parseSizeList(value).names;

/** The shape used when a pattern didn't store one: "a (b) c", "a (b, c) d", or "a (b)". */
export function defaultShape(n) {
  if (n < 2) return null;
  if (n === 2) return ['o', { b: 1 }];
  return ['o', { b: n - 2 }, 'o'];
}

/** RegExp (global) matching one size group of the given shape; captures one number per size. */
export function shapeRegex(shape) {
  if (!shape || !shape.length) return null;
  let src = '';
  for (const t of shape) {
    if (t === ',') { src += String.raw`\s*,?`; continue; }
    if (src) src += String.raw`\s*`;
    src += t === 'o'
      ? `(${NUM})`
      : String.raw`\(\s*` + Array.from({ length: t.b }, () => `(${NUM})`).join(String.raw`\s*,\s*`) + String.raw`\s*\)`;
  }
  return new RegExp(src, 'g');
}

/** Old API kept for callers that only know the number of sizes. */
export function groupRegex(n) { return shapeRegex(defaultShape(n)); }

const clean = (s) => s.replace(/\s+/g, '');
const count = (shape) => (shape || []).reduce((n, t) => n + (t === 'o' ? 1 : t === ',' ? 0 : t.b), 0);

/**
 * The part of a shape that covers sizes from..to (0-based, inclusive), or null when those
 * sizes don't start and end on whole tokens. "(Sizes D-F only)" text is written in that part's shape.
 */
export function subShape(shape, from, to) {
  if (!shape) return null;
  const out = [];
  let pos = 0;
  for (const t of shape) {
    if (t === ',') { if (out.length && pos <= to) out.push(','); continue; }
    const k = t === 'o' ? 1 : t.b;
    const end = pos + k - 1;
    if (pos >= from && end <= to) out.push(t);
    else if (pos <= to && end >= from) return null;      // a bracket cut in two
    pos += k;
  }
  while (out[out.length - 1] === ',') out.pop();
  return count(out) === to - from + 1 && out.length ? out : null;
}

/**
 * Size names in a short list: "S, M and L", "D-F" (a range in the pattern's own order),
 * "2XL/3XL". Every word must be a size name (or and/or/&), else null.
 */
export function sizesIn(head, sizeNames) {
  if (!head || !sizeNames || !sizeNames.length) return null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = [...sizeNames].sort((a, b) => b.length - a.length).map(esc).join('|');
  const re = new RegExp(`^\\s*(${alt})(?:\\s*[-–]\\s*(${alt}))?\\s*(?:,|&|\\band\\b|\\bor\\b|$)`, 'i');
  const out = [];
  let rest = String(head).replace(/^[\s(]+|[\s)]+$/g, '');
  while (rest) {
    const m = re.exec(rest);
    if (!m) return null;
    const a = sizeNames.findIndex((s) => s.toLowerCase() === m[1].toLowerCase());
    const b = m[2] ? sizeNames.findIndex((s) => s.toLowerCase() === m[2].toLowerCase()) : a;
    if (a < 0 || b < a) return null;
    for (let k = a; k <= b; k++) if (!out.includes(sizeNames[k])) out.push(sizeNames[k]);
    rest = rest.slice(m[0].length).trim();
  }
  return out.length ? out : null;
}

/**
 * A heading for some sizes only: "Edging (Sizes D-F only)", "Only for size S". Returns
 * { sizes, name } (name without the size part) or null. "(all sizes)" gives { sizes: null, name }.
 */
export function headingSizes(heading, sizeNames) {
  const h = String(heading || '');
  if (/\(\s*all sizes\s*\)\s*$/i.test(h)) return { sizes: null, name: h.replace(/\s*\(\s*all sizes\s*\)\s*$/i, '').trim() };
  const m = /^(.*?)\s*\(\s*(?:only\s+(?:for\s+)?)?sizes?\s+([^()]{1,40}?)(?:\s+only)?\s*\)\s*$/i.exec(h)
    || /^(.*?)\s*[-–:,]?\s*(?:only\s+(?:for\s+)?sizes?|sizes?)\s+([^()]{1,40}?)\s+only\s*$/i.exec(h);
  if (!m) return null;
  const sizes = sizesIn(m[2], sizeNames);
  return sizes ? { sizes, name: m[1].trim() || h } : null;
}

/** Values of the first size group in a text, or null: "42 (53) 60 times" -> ['42','53','60'] */
export function groupValues(text, n, shape = null) {
  const re = shapeRegex(shape || defaultShape(n));
  if (!re) return null;
  const m = re.exec(text);
  return m ? m.slice(1, 1 + count(shape || defaultShape(n))).map(clean) : null;
}

/** Replace every size group by the number for size index i (0-based). */
export function pickSize(text, i, n, shape = null) {
  const sh = shape && count(shape) === n ? shape : defaultShape(n);
  const re = shapeRegex(sh);
  if (!re || text == null) return text;
  return String(text).replace(re, (...m) => clean(m[1 + i]));
}

/**
 * "Only sizes (XS, L, XL): …", "Only size S: …", "Only sizes 2XL, 3XL, 4XLand 5XL: …".
 * Returns null if the text isn't such a line, else { sizes: [names in order], body }.
 * Size names are matched against the pattern's own sizes (longest first), so missing
 * spaces ("4XLand") and "and" are handled.
 */
export function onlySizes(text, sizeNames) {
  if (!sizeNames || !sizeNames.length) return null;
  // "Size I: …" / "Sizes S and M: …": a line that starts with nothing but size names.
  const plain = /^\s*sizes?\s+([^:]{1,40}?)\s*:\s*([\s\S]*)$/i.exec(text || '');
  if (plain) {
    const sizes = sizesIn(plain[1], sizeNames);
    if (sizes) return { sizes, body: plain[2].trim() };
  }
  const m = /^\s*only\s+(?:for\s+)?sizes?\s*:?\s*(.*?)\s*:\s*([\s\S]*)$/i.exec(text || '');
  if (!m) return null;
  const head = m[1];
  if (head.length > 80) return null;
  const alt = [...sizeNames].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (s.length === 1 ? '(?![A-Za-z])' : '')).join('|');
  const re = new RegExp(`(?<![A-Za-z0-9])(${alt})(?![0-9X])`, 'g');
  const sizes = [];
  let mm;
  while ((mm = re.exec(head))) sizes.push(mm[1]);
  if (!sizes.length) return null;
  return { sizes, body: m[2].trim() };
}

/** Inside an "Only sizes" paragraph: "K (2, 10, 2)" -> the number for position j of k sizes. */
export function pickInList(text, j, k) {
  if (k < 2 || text == null) return text;
  let out = String(text).replace(shapeRegex([{ b: k }]), (...m) => clean(m[1 + j]));
  // "K 3 (5)" / "K 2 (4, 6)": first size outside the brackets, the rest inside.
  out = out.replace(shapeRegex(['o', { b: k - 1 }]), (...m) => clean(m[1 + j]));
  return out;
}

/** Parse a number like "82¾" or "1,5" -> 82.75 / 1.5 */
export function toNumber(s) {
  const fr = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  const t = String(s).trim();
  const f = fr[t.slice(-1)] || 0;
  const base = f ? t.slice(0, -1) : t;
  const n = base ? parseFloat(base.replace(',', '.')) : 0;
  return (Number.isNaN(n) ? 0 : n) + f;
}
