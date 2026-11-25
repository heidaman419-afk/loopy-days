// Thin wrapper around Mozilla pdf.js (vendor/pdfjs, loaded lazily on pattern screens only).
// Everything runs on this device: nothing is sent anywhere.

let libPromise = null;
const VENDOR = new URL('../../vendor/pdfjs/', import.meta.url);

export function loadPdfLib() {
  if (!libPromise) {
    libPromise = import('../../vendor/pdfjs/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', VENDOR).href;
      return lib;
    });
  }
  return libPromise;
}

/** Open a PDF from a Blob/File/ArrayBuffer. Works on a copy (pdf.js takes ownership of its buffer). */
export async function openPdf(source) {
  const lib = await loadPdfLib();
  const buf = source instanceof ArrayBuffer ? source.slice(0) : await source.arrayBuffer();
  return lib.getDocument({
    data: new Uint8Array(buf),
    fontExtraProperties: true,          // keeps real font names, so bold headings can be found
    standardFontDataUrl: new URL('standard_fonts/', VENDOR).href,
    isEvalSupported: false,
  }).promise;
}

/** Free a document's memory and its worker (the API moved between pdf.js versions). */
export function closePdf(doc) {
  if (!doc) return;
  try {
    if (typeof doc.destroy === 'function') doc.destroy();
    else if (doc.loadingTask && typeof doc.loadingTask.destroy === 'function') doc.loadingTask.destroy();
    else if (typeof doc.cleanup === 'function') doc.cleanup();
  } catch (e) { console.warn('pdf close', e); }
}

const BOLD = /bold|black|heavy|semibold|demi/i;
const ITALIC = /italic|oblique/i;

/**
 * Text of every page as positioned items: [{ p, w, h, items: [{ s, x, y, fs, w, bold, italic }] }]
 * onPage(n, total) reports progress.
 */
export async function extractPages(doc, onPage) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    await page.getOperatorList();          // loads the page's fonts, so their names are known
    const tc = await page.getTextContent();
    const fontName = (id) => {
      try { const f = page.commonObjs.get(id); return (f && f.name) || ''; } catch { return ''; }
    };
    const names = {};
    for (const id of Object.keys(tc.styles)) names[id] = fontName(id);
    pages.push({
      p, w: vp.width, h: vp.height,
      items: tc.items.filter((i) => typeof i.str === 'string').map((i) => ({
        s: i.str,
        x: i.transform[4],
        y: i.transform[5],
        fs: Math.round(Math.hypot(i.transform[0], i.transform[1]) * 10) / 10,
        w: i.width,
        bold: BOLD.test(names[i.fontName] || ''),
        italic: ITALIC.test(names[i.fontName] || ''),
      })),
    });
    page.cleanup();
    if (onPage) onPage(p, doc.numPages);
  }
  return pages;
}

/** Draw a page into a canvas `cssWidth` CSS pixels wide (sharp on this screen, memory-capped). */
export async function renderPage(doc, n, cssWidth, canvas = document.createElement('canvas'), maxPixels = 12e6) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  let dpr = Math.min(window.devicePixelRatio || 1, 3);
  let scale = (cssWidth / base.width) * dpr;
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.round((vp.height / vp.width) * cssWidth)}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, viewport: vp, canvas });
  await task.promise;
  page.cleanup();
  return canvas;
}

/**
 * A cover picture from a page: the photo area if the page has one (the tallest band of
 * mostly-coloured rows), otherwise the whole page. Returns a JPEG Blob.
 */
export async function coverFromPage(doc, n = 1, width = 1000, quality = 0.84) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  page.cleanup();
  const W = canvas.width; const H = canvas.height;
  const px = ctx.getImageData(0, 0, W, H).data;
  const inked = (i) => (765 - px[i] - px[i + 1] - px[i + 2]) > 90;
  const rowFill = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let n2 = 0;
    for (let x = 0; x < W; x += 2) if (inked((y * W + x) * 4)) n2++;
    rowFill[y] = n2 / (W / 2);
  }
  // Longest run of rows that are mostly picture (small gaps allowed).
  let best = [0, 0]; let start = -1; let gap = 0;
  for (let y = 0; y <= H; y++) {
    const on = y < H && rowFill[y] > 0.3;
    if (on) { if (start < 0) start = y; gap = 0; }
    else if (start >= 0) {
      gap++;
      if (gap > 8 || y === H) {
        const end = y - gap;
        if (end - start > best[1] - best[0]) best = [start, end];
        start = -1; gap = 0;
      }
    }
  }
  let out = canvas;
  if (best[1] - best[0] > H * 0.18) {
    const [y0, y1] = best;
    let x0 = W; let x1 = 0;
    for (let x = 0; x < W; x += 2) {
      let n2 = 0;
      for (let y = y0; y < y1; y += 3) if (inked((y * W + x) * 4)) n2++;
      if (n2 / ((y1 - y0) / 3) > 0.3) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
    if (x1 > x0) {
      out = document.createElement('canvas');
      out.width = x1 - x0 + 1;
      out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    }
  }
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the page'))), 'image/jpeg', quality));
}

/** A page as a JPEG Blob (cover images, chart snapshots). */
export async function pageToJpeg(doc, n, width = 900, quality = 0.85) {
  const canvas = document.createElement('canvas');
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / base.width });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  page.cleanup();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the page'))), 'image/jpeg', quality));
}
