// Sizes in pattern text (pure functions).
//
// Patterns write one number per size as "a (b) c" or "a (b, c) d" (first size outside the
// brackets, the middle sizes inside, the last size after). Picking a size replaces every
// such group by that size's number.

// A space is only part of a number when a fraction follows it ("1 ½"), never on its own.
const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:\s?[¼½¾⅓⅔⅛])?|[¼½¾⅓⅔⅛])`;
const TOKEN = /^[A-Za-z0-9/½¼¾.+\-]{1,8}$/;

/** "S (M) L (here …)", "XS (S, M) L", "1 (2, 3) 4", "S, M, L", "S/M/L" -> ['S', 'M', 'L'] */
export function parseSizes(value) {
  const v = String(value || '').trim();
  if (!v) return [];
  // a (b, c) d form
  const m = new RegExp(String.raw`^([^\s(),]+)\s*\(([^()]+)\)\s*([^\s(),]+)`).exec(v);
  if (m) {
    const inner = m[2].split(/\s*,\s*/);
    const all = [m[1], ...inner, m[3]].map((s) => s.trim());
    if (all.every((s) => TOKEN.test(s))) return all;
  }
  // a (b) form (two sizes)
  const two = /^([^\s(),]+)\s*\(([^\s(),]+)\)/.exec(v);
  if (two && TOKEN.test(two[1]) && TOKEN.test(two[2])) return [two[1], two[2]];
  // comma / slash lists
  const list = v.split(/\s*[,/]\s*|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  if (list.length > 1 && list.every((s) => TOKEN.test(s))) return list;
  if (TOKEN.test(v)) return [v];
  return [];
}

/** RegExp matching one size group for n sizes (global). */
export function groupRegex(n) {
  if (n < 2) return null;
  if (n === 2) return new RegExp(String.raw`(${NUM})\s*\((${NUM})\)`, 'g');
  const inner = Array.from({ length: n - 2 }, () => `(${NUM})`).join(String.raw`\s*,\s*`);
  return new RegExp(String.raw`(${NUM})\s*\(${inner}\)\s*(${NUM})`, 'g');
}

const clean = (s) => s.replace(/\s+/g, '');

/** Values of the first size group in a text, or null: "42 (53) 60 times" -> ['42','53','60'] */
export function groupValues(text, n) {
  const re = groupRegex(n);
  if (!re) return null;
  const m = re.exec(text);
  return m ? m.slice(1).map(clean) : null;
}

/** Replace every size group by the number for size index i (0-based). */
export function pickSize(text, i, n) {
  const re = groupRegex(n);
  if (!re || text == null) return text;
  return String(text).replace(re, (...m) => clean(m[1 + i]));
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
