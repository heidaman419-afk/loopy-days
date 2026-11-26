// Sizes in pattern text (pure functions).
//
// A pattern lists its sizes once, e.g. "S (M) L" or "XS (S, M, L) (XL, 2XL, 3XL) (4XL, 5XL)".
// That list has a SHAPE: a row of tokens, each either one size outside brackets ('o') or a
// bracketed group of k sizes ({ b: k }). Every number that changes by size is written in the
// same shape ("6 (6) 6", "96 (100, 100, 104) (104, 108, 108) (112, 112)"). Picking a size
// replaces every such group with the number at that size's position.

const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:\s?[¼½¾⅓⅔⅛])?|[¼½¾⅓⅔⅛])`;
const TOKEN = /^[A-Za-z0-9/½¼¾.+\-]{1,8}$/;

/**
 * Read a size list. Returns { names, shape }.
 * "S (M) L (here …)" -> names S,M,L shape [o, b1, o]; "XS (S, M) L" -> [o, b2, o];
 * "XS (S, M, L) (XL, 2XL, 3XL) (4XL, 5XL)" -> [o, b3, b3, b2]; "S, M, L" -> no shape.
 */
export function parseSizeList(value) {
  const v = String(value || '').trim();
  const names = [];
  const shape = [];
  let i = 0;
  while (i < v.length) {
    while (i < v.length && /\s/.test(v[i])) i++;
    if (i >= v.length) break;
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
      if (v[i] === ',') break;                                           // a plain comma list
    }
  }
  if (names.length > 1 && shape.some((t) => t !== 'o')) return { names, shape };
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
  const parts = shape.map((t) => (t === 'o'
    ? `(${NUM})`
    : String.raw`\(\s*` + Array.from({ length: t.b }, () => `(${NUM})`).join(String.raw`\s*,\s*`) + String.raw`\s*\)`));
  return new RegExp(parts.join(String.raw`\s*`), 'g');
}

/** Old API kept for callers that only know the number of sizes. */
export function groupRegex(n) { return shapeRegex(defaultShape(n)); }

const clean = (s) => s.replace(/\s+/g, '');
const count = (shape) => (shape || []).reduce((n, t) => n + (t === 'o' ? 1 : t.b), 0);

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
  const m = /^\s*only\s+(?:for\s+)?sizes?\s*:?\s*(.*?)\s*:\s*([\s\S]*)$/i.exec(text || '');
  if (!m || !sizeNames || !sizeNames.length) return null;
  const head = m[1];
  if (head.length > 80) return null;
  const alt = [...sizeNames].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
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
