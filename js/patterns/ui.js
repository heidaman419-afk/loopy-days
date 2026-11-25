// Small shared bits for pattern screens.

import { esc } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { openSheet } from '../ui/overlay.js';
import { categoryGroup, weightLabel } from '../data/patterns.js';
import * as db from '../db.js';

export const groupIcon = (group) => ({
  tops: icons.cat_top, shawls: icons.cat_shawl, hats: icons.cat_hat, socks: icons.cat_socks,
  blankets: icons.cat_blanket, toys: icons.cat_toy, other: icons.cat_other, all: icons.cat_other,
}[group] || icons.cat_other);
export const categoryIcon = (key) => groupIcon(categoryGroup(key));

export const KIND_LABEL = {
  cast_on: 'Cast on', rows: 'Rows', repeat: 'Repeat', text: 'Text', bind_off: 'Bind off', pick_up: 'Pick up', chart: 'Chart',
};

/** Short line describing a block: "Repeat 60 times · 6 rows". */
export function blockSummary(b) {
  const n = (b.rows || []).length;
  if (b.kind === 'repeat') return `${b.times || 1} times · ${n} ${n === 1 ? 'row' : 'rows'}`;
  if (b.kind === 'rows') return `${n} ${n === 1 ? 'row' : 'rows'}`;
  if (b.kind === 'cast_on') return `${b.stitches || '?'} sts${b.method ? ` · ${b.method}` : ''}`;
  if (b.kind === 'pick_up') return `${b.stitches || '?'} sts`;
  if (b.kind === 'chart') return b.image_file_id ? 'Chart image' : 'Chart';
  return (b.text || '').slice(0, 60);
}

/**
 * Instruction text, escaped, with glossary abbreviations as buttons (tap to explain).
 * The text is escaped first; only whole-word matches are wrapped afterwards.
 */
export function markup(text, glossary = []) {
  let html = esc(text || '');
  const keys = glossary
    .map((g) => ({ ...g, re: g.abbr.replace(/\(s\)$/i, '') }))
    .filter((g) => /^[A-Za-z][A-Za-z0-9]{0,8}$/.test(g.re))
    .sort((a, b) => b.re.length - a.re.length);
  if (!keys.length) return html;
  const alt = keys.map((k) => k.re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(^|[^A-Za-z0-9&;])((?:${alt})s?)(?![A-Za-z0-9])`, 'gi');
  html = html.replace(re, (m, pre, word) => {
    const k = keys.find((x) => x.re.toLowerCase() === word.toLowerCase() || `${x.re.toLowerCase()}s` === word.toLowerCase());
    if (!k) return m;
    // Single letters ("k", "p") only when they're clearly stitch codes: K2, p1, k-tbl...
    if (k.re.length === 1) return m;
    return `${pre}<button type="button" class="abbr" data-abbr="${esc(k.abbr)}">${word}</button>`;
  });
  // Stitch codes like K2 / p3 explain "k" / "p".
  const one = keys.filter((k) => k.re.length === 1).map((k) => k.re.toLowerCase());
  if (one.length) {
    html = html.replace(new RegExp(`(^|[\\s,(])(${one.join('|')})(\\d+)(?![A-Za-z])`, 'gi'), (m, pre, letter, num) =>
      `${pre}<button type="button" class="abbr" data-abbr="${esc(keys.find((k) => k.re.toLowerCase() === letter.toLowerCase()).abbr)}">${letter}${num}</button>`);
  }
  return html;
}

/** Wire tap-to-explain on a container. */
export function explainAbbrs(root, getGlossary) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.abbr');
    if (!b) return;
    e.stopPropagation();
    const g = (getGlossary() || []).find((x) => x.abbr === b.dataset.abbr);
    if (!g) return;
    openSheet({ title: g.abbr, body: `<p class="abbr-meaning">${esc(g.meaning)}</p>` });
  });
}

/** "Brand Yarn name" / "200 g" for one size (or all sizes). */
export function yarnTitle(y) { return [y.brand, y.name].filter(Boolean).join(' ') || 'Yarn'; }
export function yarnAmount(y, sizeIndex = null) {
  const parts = [];
  if (y.grams && y.grams.length) {
    parts.push(sizeIndex != null && y.grams[sizeIndex] != null ? `${y.grams[sizeIndex]} g` : `${y.grams_text || y.grams.join(' / ') + ' g'}`);
  } else if (y.grams_text) parts.push(y.grams_text);
  if (y.length_min || y.length_max) parts.push(y.length_min === y.length_max || !y.length_max ? `${y.length_min || y.length_max} ${y.length_unit}` : `${y.length_min}–${y.length_max} ${y.length_unit}`);
  if (y.weight) parts.push(weightLabel(y.weight));
  return parts.join(' · ');
}

/** Where "knit this project" goes: its guide if one is ready for its pattern + size, else the counter. */
export async function knitTarget(project) {
  if (project && project.kind !== 'quick' && project.pattern_id) {
    const { guideId } = await import('../data/patterns.js');
    const g = await db.get('guides', guideId(project.pattern_id, project.size_id));
    if (g && !g.deleted && g.tree && (g.tree.pieces || []).length) return { href: `#/guide/${project.id}`, guide: g };
  }
  return { href: project && project.kind === 'quick' ? '#/counter' : `#/counter/${project.id}`, guide: null };
}
