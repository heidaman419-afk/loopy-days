// Real PDF text for a legend line: the text items (pdf.js getTextContent) that sit beside a swatch,
// inside its label box. Works only when the legend is typed text; a legend inside a picture has none.

/** Text items in raster coordinates at viewport vp: { s, x0, x1, top, base, h }. */
export function textBoxes(textContent, vp) {
  const out = [];
  for (const it of textContent.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const t = it.transform, fs = Math.hypot(t[2], t[3]) * vp.scale;
    const [x, base] = vp.convertToViewportPoint(t[4], t[5]);
    out.push({ s: it.str, x0: x, x1: x + it.width * vp.scale, top: base - fs * 0.8, base, h: fs });
  }
  return out;
}

/**
 * Words for one legend line: items whose height mostly overlaps the label's band and that start inside
 * the label box (right of the swatch). Joined left to right; '' when the label is not real text.
 */
export function legendText(boxes, swatch, label) {
  const sh = swatch.y1 - swatch.y0;
  if (label.y0 >= swatch.y1 - 2) {
    // Label below the swatch: the text items inside the label box.
    const hits = boxes.filter((b) => b.x0 >= label.x0 - sh * 0.5 && b.x0 <= label.x1 && Math.min(b.base, label.y1 + sh * 0.3) - Math.max(b.top, label.y0 - sh * 0.3) >= (b.base - b.top) * 0.5)
      .sort((a, b) => a.top - b.top || a.x0 - b.x0);
    return hits.map((b) => b.s).join(' ').replace(/\s+/g, ' ').trim();
  }
  const b0 = Math.min(swatch.y0, label.y0) - sh * 0.25, b1 = Math.max(swatch.y1, label.y1) + sh * 0.25;
  const hits = boxes.filter((b) => {
    const ov = Math.min(b.base, b1) - Math.max(b.top, b0);
    return ov >= (b.base - b.top) * 0.5 && b.x0 >= swatch.x1 - 1 && b.x0 <= label.x1 + sh * 0.5;
  }).sort((a, b) => a.x0 - b.x0);
  let s = '';
  for (const [i, b] of hits.entries()) {
    const gap = i ? b.x0 - hits[i - 1].x1 : 0;
    s += (i && gap > b.h * 0.15 && !s.endsWith(' ') && !b.s.startsWith(' ') ? ' ' : '') + b.s;
  }
  return s.replace(/\s+/g, ' ').trim();
}
