// "Fill in from a PDF": read a pattern PDF on this device and turn it into form values.
// Steps are reported as they happen so the screen can show progress.

import { openPdf, extractPages, pageToJpeg, coverFromPage, closePdf, loadPdfLib } from './pdf.js';
import { logicalLines } from './parse-lines.js';
import { parseMeta } from './parse-meta.js';

export const STEPS = ['open', 'pages', 'details', 'charts', 'form'];
const CHART_SCAN_MS = 45000;   // never let the chart search hold up the form for longer than this

/**
 * file: the PDF (File/Blob). onStep(step, info) is called for 'open', 'pages' (with {page, of}),
 * 'details', 'charts' (with {page, of}) and 'form'. Returns { meta, sourceGroups, pages, cover, chartPages }
 * (chartPages: [{ page, grid: "cols×rows" }], pages where a chart grid was seen; [] if none or on error).
 */
export async function readPatternPdf(file, onStep = () => {}) {
  onStep('open');
  const doc = await openPdf(file);
  try {
    onStep('pages', { page: 0, of: doc.numPages });
    const pages = await extractPages(doc, (page, of) => onStep('pages', { page, of }));
    onStep('details');
    // Each part is guarded: an unexpected layout still fills in what could be read.
    let lines = [];
    try { lines = logicalLines(pages); } catch (e) { console.warn('lines', e); }
    let meta;
    try { meta = parseMeta(lines); } catch (e) {
      console.warn('details', e);
      meta = { name: '', designer: '', sizes: [], sizeShape: null, measurements: [], gauge: '', needles: '', tools: [], yarns: [], notions: '', description: '', glossary: [], notes: [], instructionGroups: [] };
      try { const big = lines.filter((l) => l.page === 1).sort((a, b) => b.fs - a.fs)[0]; if (big) meta.name = big.text; } catch { /* nothing */ }
    }
    // Keep only what the guide builder needs: headings (+ piece/section level), pages and line texts.
    const sourceGroups = (meta.instructionGroups || []).map((g) => ({
      heading: g.heading, level: g.level || 'section', page: g.page,
      lines: g.lines.map((l) => ({ text: l.text, page: l.page })),
    }));
    // Charts: which pages have a chart grid (guarded: a failure or a slow phone never stops the form).
    const chartPages = [];
    try {
      onStep('charts', { page: 0, of: doc.numPages });
      const lib = await loadPdfLib();
      const { quickScan } = await import('./chart-read.js');
      const t0 = Date.now();
      for (let p = 1; p <= doc.numPages && Date.now() - t0 < CHART_SCAN_MS; p++) {
        onStep('charts', { page: p, of: doc.numPages });
        const page = await doc.getPage(p);
        const grid = await quickScan(page, lib);
        page.cleanup();
        if (grid) chartPages.push({ page: p, grid });
      }
    } catch (e) { console.warn('chart search', e); }
    let cover = null;
    try { cover = await coverFromPage(doc, 1); } catch (e) {
      console.warn('cover', e);
      try { cover = await pageToJpeg(doc, 1, 900, 0.82); } catch { /* no cover */ }
    }
    onStep('form');
    delete meta.groups;
    delete meta.instructionGroups;
    return { meta, sourceGroups, pages: doc.numPages, cover, chartPages };
  } finally {
    closePdf(doc);
  }
}
