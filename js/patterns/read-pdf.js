// "Fill in from a PDF": read a pattern PDF on this device and turn it into form values.
// Steps are reported as they happen so the screen can show progress.

import { openPdf, extractPages, pageToJpeg, coverFromPage, closePdf } from './pdf.js';
import { logicalLines } from './parse-lines.js';
import { parseMeta } from './parse-meta.js';

export const STEPS = ['open', 'pages', 'details', 'form'];

/**
 * file: the PDF (File/Blob). onStep(step, info) is called for 'open', 'pages' (with {page, of}),
 * 'details' and 'form'. Returns { meta, sourceGroups, pages, cover }.
 */
export async function readPatternPdf(file, onStep = () => {}) {
  onStep('open');
  const doc = await openPdf(file);
  try {
    onStep('pages', { page: 0, of: doc.numPages });
    const pages = await extractPages(doc, (page, of) => onStep('pages', { page, of }));
    onStep('details');
    const lines = logicalLines(pages);
    const meta = parseMeta(lines);
    // Keep only what the guide builder needs: headings, pages and line texts.
    const sourceGroups = meta.instructionGroups.map((g) => ({
      heading: g.heading, page: g.page,
      lines: g.lines.map((l) => ({ text: l.text, page: l.page })),
    }));
    let cover = null;
    try { cover = await coverFromPage(doc, 1); } catch (e) {
      console.warn('cover', e);
      try { cover = await pageToJpeg(doc, 1, 900, 0.82); } catch { /* no cover */ }
    }
    onStep('form');
    delete meta.groups;
    delete meta.instructionGroups;
    return { meta, sourceGroups, pages: doc.numPages, cover };
  } finally {
    closePdf(doc);
  }
}
