// Loopy Days knitting chart symbol library (our own drawings and wording; no third-party symbol set).
// Each entry: id, name, abbr, group, uses (stitches consumed from the row below), makes (stitches it
// leaves on the needle; a chart cell is one made stitch), aliases (words that identify it in a legend),
// and a glyph drawn in a 100×100 box: lines/paths are stroked, dots filled, rings stroked circles.
// "None" (no stitch) makes and uses nothing. Colour is chosen separately (colourwork).

export const SYMBOLS = [
  { id: 'k', name: 'Knit', abbr: 'k', group: 'Basics', uses: 1, makes: 1, aliases: ['knit', 'k on rs', 'stockinette'], glyph: {} },
  { id: 'p-dot', name: 'Purl', abbr: 'p', group: 'Basics', uses: 1, makes: 1, aliases: ['purl', 'p on rs'], glyph: { dots: [[50, 50, 9]] } },
  { id: 'p-dash', name: 'Purl (dash)', abbr: 'p', group: 'Basics', uses: 1, makes: 1, aliases: [], glyph: { paths: ['M28 50 L72 50'] } },
  { id: 'none', name: 'No stitch', abbr: '—', group: 'Basics', uses: 0, makes: 0, none: true, aliases: ['no stitch', 'no-stitch', 'nothing'], glyph: { grey: true } },
  { id: 'yo', name: 'Yarn over', abbr: 'yo', group: 'Increases', uses: 0, makes: 1, aliases: ['yarn over', 'yarnover', 'yo'], glyph: { rings: [[50, 50, 22]] } },
  { id: 'm1l', name: 'Make 1 left', abbr: 'M1L', group: 'Increases', uses: 0, makes: 1, aliases: ['make 1 left', 'make one left', 'm1l'], glyph: { paths: ['M30 75 L30 30 L50 55 L70 30 L70 75', 'M22 22 L38 22'] } },
  { id: 'm1r', name: 'Make 1 right', abbr: 'M1R', group: 'Increases', uses: 0, makes: 1, aliases: ['make 1 right', 'make one right', 'm1r'], glyph: { paths: ['M30 75 L30 30 L50 55 L70 30 L70 75', 'M62 22 L78 22'] } },
  { id: 'm1', name: 'Make 1', abbr: 'M1', group: 'Increases', uses: 0, makes: 1, aliases: ['make 1', 'make one', 'm1'], glyph: { paths: ['M30 75 L30 30 L50 55 L70 30 L70 75'] } },
  { id: 'kfb', name: 'Knit front and back', abbr: 'kfb', group: 'Increases', uses: 1, makes: 2, span: 1, aliases: ['knit front and back', 'kfb'], glyph: { paths: ['M30 25 L50 50 L70 25', 'M50 50 L50 78'] }, note: 'One cell that makes 2 stitches' },
  { id: 'k2tog', name: 'Knit 2 together', abbr: 'k2tog', group: 'Decreases', uses: 2, makes: 1, pair: 'k2tog-2', aliases: ['knit 2 together', 'knit two together', 'k2tog'], glyph: { paths: ['M28 78 L72 22'] } },
  { id: 'k2tbl', name: 'Knit 2 together through the back loop', abbr: 'k2tog tbl', group: 'Decreases', uses: 2, makes: 1, pair: 'k2tbl-2', aliases: ['knit 2 together through the back loop', 'knit 2 twisted together', 'knit two twisted together', 'k2tog tbl', 'k2tbl'], glyph: { paths: ['M28 78 L72 22', 'M58 78 C 72 66, 72 54, 60 50'] } },
  { id: 'ssk', name: 'Slip, slip, knit', abbr: 'ssk', group: 'Decreases', uses: 2, makes: 1, pair: 'ssk-2', aliases: ['slip slip knit', 'slip, slip, knit', 'ssk'], glyph: { paths: ['M28 22 L72 78'] } },
  { id: 'p2tog', name: 'Purl 2 together', abbr: 'p2tog', group: 'Decreases', uses: 2, makes: 1, pair: 'p2tog-2', aliases: ['purl 2 together', 'purl two together', 'p2tog'], glyph: { paths: ['M28 78 L72 22'], dots: [[68, 70, 7]] } },
  { id: 'ssp', name: 'Slip, slip, purl', abbr: 'ssp', group: 'Decreases', uses: 2, makes: 1, aliases: ['slip slip purl', 'ssp'], glyph: { paths: ['M28 22 L72 78'], dots: [[32, 70, 7]] } },
  { id: 'k3tog', name: 'Knit 3 together', abbr: 'k3tog', group: 'Decreases', uses: 3, makes: 1, aliases: ['knit 3 together', 'knit three together', 'k3tog'], glyph: { paths: ['M28 78 L72 22', 'M50 78 L72 50'] } },
  { id: 'sssk', name: 'Slip, slip, slip, knit', abbr: 'sssk', group: 'Decreases', uses: 3, makes: 1, aliases: ['slip slip slip knit', 'sssk'], glyph: { paths: ['M28 22 L72 78', 'M28 50 L50 78'] } },
  { id: 'cdd', name: 'Centred double decrease', abbr: 'cdd', group: 'Decreases', uses: 3, makes: 1, aliases: ['centred double decrease', 'centered double decrease', 'cdd', 's2kpo', 'sl2-k1-p2sso'], glyph: { paths: ['M25 75 L50 25 L75 75', 'M50 25 L50 80'] } },
  { id: 'sk2p', name: 'Slip 1, knit 2 together, pass over', abbr: 'sk2p', group: 'Decreases', uses: 3, makes: 1, aliases: ['sk2p', 'sk2po', 'slip 1 knit 2 together pass'], glyph: { paths: ['M25 75 L50 25 L75 75'] } },
  // Decreases drawn across 2 cells (one mark in each cell): each cell uses 1 stitch and the pair makes 1.
  { id: 'k2tog-2', name: 'Knit 2 together (2 cells)', abbr: 'k2tog', group: 'Decreases over 2 cells', uses: 1, makes: 0.5, span: 2, aliases: [], glyph: { paths: ['M30 72 L70 28'] } },
  { id: 'k2tbl-2', name: 'Knit 2 together through the back loop (2 cells)', abbr: 'k2tog tbl', group: 'Decreases over 2 cells', uses: 1, makes: 0.5, span: 2, aliases: [], glyph: { paths: ['M30 72 L70 28'], dots: [[70, 74, 6]] } },
  { id: 'ssk-2', name: 'Slip, slip, knit (2 cells)', abbr: 'ssk', group: 'Decreases over 2 cells', uses: 1, makes: 0.5, span: 2, aliases: [], glyph: { paths: ['M30 28 L70 72'] } },
  { id: 'p2tog-2', name: 'Purl 2 together (2 cells)', abbr: 'p2tog', group: 'Decreases over 2 cells', uses: 1, makes: 0.5, span: 2, aliases: [], glyph: { paths: ['M30 72 L70 28'], dots: [[30, 74, 6]] } },
  { id: 'ktbl', name: 'Knit through the back loop', abbr: 'ktbl', group: 'Twisted', uses: 1, makes: 1, aliases: ['knit through the back loop', 'through the back loop', 'knit tbl', 'ktbl', 'twisted knit'], glyph: { paths: ['M30 88 C 45 70, 70 55, 68 35 C 66 15, 34 15, 32 35 C 30 55, 55 70, 70 88'] } },
  { id: 'ptbl', name: 'Purl through the back loop', abbr: 'ptbl', group: 'Twisted', uses: 1, makes: 1, aliases: ['purl through the back loop', 'purl tbl', 'ptbl'], glyph: { paths: ['M32 76 C 45 62, 68 50, 66 32 C 64 14, 36 14, 34 32 C 32 50, 55 62, 68 76'], dots: [[50, 89, 6]] } },
  { id: 'sl-wyib', name: 'Slip 1 with yarn in back', abbr: 'sl1 wyib', group: 'Slipped', uses: 1, makes: 1, aliases: ['slip 1 with yarn in back', 'wyib', 'slip stitch', 'sl1'], glyph: { paths: ['M30 25 L50 78 L70 25'] } },
  { id: 'sl-wyif', name: 'Slip 1 with yarn in front', abbr: 'sl1 wyif', group: 'Slipped', uses: 1, makes: 1, aliases: ['slip 1 with yarn in front', 'wyif'], glyph: { paths: ['M30 25 L50 70 L70 25', 'M30 84 L70 84'] } },
  { id: 'bobble', name: 'Bobble', abbr: 'MB', group: 'Texture', uses: 1, makes: 1, aliases: ['bobble', 'make bobble', 'mb', 'popcorn'], glyph: { dots: [[50, 50, 20]] } },
  { id: 'twist', name: 'Cable or twist (spans cells)', abbr: 'cable', group: 'Cables', uses: 1, makes: 1, aliases: ['cable', 'twist', 'cross', 'rt', 'lt', '1/1', '2/2'], glyph: { paths: ['M25 78 L75 22', 'M25 22 L42 42', 'M58 58 L75 78'] }, note: 'Each covered cell counts as one stitch' },
];

export const COLOURS = ['Main colour', 'Contrast colour', 'Contrast colour 2', 'Contrast colour 3', 'Contrast colour 4'];
const COLOUR_ALIASES = [[/\bmain colou?r\b|\bmc\b/, 0], [/contrast colou?r ?2|\bcc ?2\b/, 2], [/contrast colou?r ?3|\bcc ?3\b/, 3], [/contrast colou?r|\bcc\b/, 1]];

export const symbolById = (id) => SYMBOLS.find((s) => s.id === id);

/** Inline SVG for a symbol (cell-sized square). */
export function symbolSVG(sym, size = 34) {
  const g = sym.glyph || {};
  const parts = [];
  if (g.grey) parts.push('<rect x="4" y="4" width="92" height="92" fill="#666"/>');
  for (const d of g.paths || []) parts.push(`<path d="${d}" fill="none" stroke="#222" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const [cx, cy, r] of g.rings || []) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#222" stroke-width="7"/>`);
  for (const [cx, cy, r] of g.dots || []) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#222"/>`);
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><rect x="2" y="2" width="96" height="96" fill="#fff" stroke="#bbb" stroke-width="3"/>${parts.join('')}</svg>`;
}

/** Draw a symbol's ink (black on white) into a canvas, for shape matching. */
export function drawSymbol(ctx, sym, px) {
  const g = sym.glyph || {}, k = px / 100;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.save(); ctx.scale(k, k);
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const d of g.paths || []) ctx.stroke(new Path2D(d));
  for (const [cx, cy, r] of g.rings || []) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  for (const [cx, cy, r] of g.dots || []) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** From legend wording: the symbol whose longest alias appears in it, and a colour slot if named.
 *  span 2 (the legend swatch is two cells): use the symbol's 2-cell version when it has one. */
export function fromLegendText(text, span = 1) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best = null, bl = 0;
  for (const s of SYMBOLS) for (const a of s.aliases) {
    const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`);
    if (a.length > bl && re.test(t)) { best = s; bl = a.length; }
  }
  const colour = COLOUR_ALIASES.find(([re]) => re.test(t));
  if (best && span === 2 && best.pair) best = symbolById(best.pair);
  return { symbol: best, colour: colour ? colour[1] : null };
}
