// Add a pattern (#/pattern-new) and Edit pattern (#/pattern-edit/<id>). Full screen.
// "Fill in from a PDF" reads the PDF on this device (pdf.js) and fills the form.

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc, el } from '../ui/dom.js';
import { openSheet, confirmDialog, toast } from '../ui/overlay.js';
import {
  newPatternRecord, getPattern, savePattern, autoGuides, setPatternPdf, setPatternCover, removePatternCover, removePatternPdf,
  coverUrl, pdfBlob, deletePattern, CATEGORIES, DIFFICULTIES, WEIGHTS, categoryLabel, guessCategory,
} from '../data/patterns.js';
import { CRAFTS } from '../data/projects.js';
import { categoryIcon, yarnTitle, yarnAmount } from '../patterns/ui.js';
import { pickPhoto } from '../ui/photo-picker.js';
import { shrinkPhoto } from '../data/photos.js';
import { startProjectFrom } from '../patterns/start-project.js';

export const fullscreen = true;
export function editMount(root, params) { return mount(root, params, true); }

const sid = () => `z${Math.random().toString(36).slice(2, 9)}`;
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export async function mount(root, params, editing = false) {
  const pattern = editing ? await getPattern(params[0]) : newPatternRecord();
  if (!pattern) { location.hash = '#/patterns'; return; }
  const v = JSON.parse(JSON.stringify(pattern));
  v.from_pdf = v.from_pdf || {};
  const pending = { pdf: null, cover: null, removeCover: false, removePdf: false };
  let coverPreview = null;   // object URL for a cover not saved yet
  let saved = false;

  const tag = (field) => (v.from_pdf[field] ? `<span class="from-pdf">${icons.check}From the PDF</span>` : '');
  const chips = (name, list, value) => list.map(([k, label]) =>
    `<button type="button" class="chip ${value === k ? 'is-on' : ''}" data-${name}="${k}" aria-pressed="${value === k}">${esc(label)}</button>`).join('');

  function render() {
    const y = root.querySelector('.pform')?.scrollTop;
    const hasPdf = (pending.pdf || (v.pdf_file_id && !pending.removePdf));
    const pdfName = pending.pdf ? pending.pdf.name : v.pdf_name;
    const pdfSize = pending.pdf ? pending.pdf.size : v.pdf_size;
    root.innerHTML = `
      <header class="form-top">
        <button type="button" class="btn btn--text btn--small" data-cancel>${editing ? 'Cancel' : 'Close'}</button>
        <h1 class="form-top__title">${editing ? 'Edit pattern' : 'Add a pattern'}</h1>
        <span class="form-top__side"></span>
      </header>
      <form class="pform" novalidate autocomplete="off">
        ${editing ? '' : `
        <label class="fill-pdf">
          <span class="fill-pdf__icon">${icons.file}</span>
          <span class="fill-pdf__text"><strong>Fill in from a PDF</strong>
            <span>Reads your pattern right here on your phone. Nothing is sent anywhere.</span></span>
          <span class="fill-pdf__go">${icons.chevronRight}</span>
          <input type="file" accept="application/pdf,.pdf" data-fill hidden>
        </label>`}

        <label class="field"><span class="field__label">Name <span class="req">(needed)</span></span>${tag('name')}
          <input class="input" name="name" maxlength="80" value="${esc(v.name)}" placeholder="e.g. Cosy weekend cardigan">
          <span class="field__error" data-name-error hidden>Give the pattern a name first.</span></label>

        <label class="field"><span class="field__label">Designer</span>${tag('designer')}
          <input class="input" name="designer" maxlength="80" value="${esc(v.designer)}" placeholder="Who designed it"></label>

        <div class="field"><span class="field__label">Pattern PDF</span>
          ${hasPdf ? `
          <div class="file-card">
            <span class="file-card__icon">${icons.file}</span>
            <span class="file-card__text"><strong>${esc(pdfName || 'Pattern.pdf')}</strong><span>${pdfSize ? kb(pdfSize) : ''}${v.pdf_pages ? ` · ${v.pdf_pages} pages` : ''}</span></span>
            <button type="button" class="btn btn--text btn--small" data-preview>Look</button>
            <button type="button" class="icon-btn icon-btn--small" data-remove-pdf aria-label="Remove PDF">${icons.trash}</button>
          </div>` : `
          <label class="dash-box dash-box--small">${icons.file}<strong>Attach the PDF</strong><span>Optional. Kept on this phone and in your private online space.</span>
            <input type="file" accept="application/pdf,.pdf" data-attach hidden></label>`}
        </div>

        <div class="field"><span class="field__label">Cover picture</span>${tag('cover')}
          <div class="cover-pick">
            <span class="cover-pick__img" data-cover-img>${icons.image}</span>
            <div class="cover-pick__actions">
              <button type="button" class="btn btn--secondary btn--small" data-cover>${icons.camera}<span>Choose</span></button>
              ${(pending.cover || (v.cover_file_id && !pending.removeCover)) ? '<button type="button" class="btn btn--text btn--small" data-remove-cover>Remove</button>' : ''}
            </div>
          </div></div>

        <div class="field"><span class="field__label">Craft</span><div class="chips">${chips('craft', CRAFTS, v.craft)}</div></div>

        <div class="field"><span class="field__label">Category</span>${tag('category')}
          <button type="button" class="select-btn" data-category>
            <span class="select-btn__icon">${v.category ? categoryIcon(v.category) : icons.list}</span>
            <span>${esc(v.category ? categoryLabel(v.category) : 'Choose a category')}</span>${icons.chevronRight}
          </button></div>

        <div class="field"><span class="field__label">How tricky</span><div class="chips chips--small">${chips('diff', DIFFICULTIES, v.difficulty || '')}</div></div>

        <label class="field"><span class="field__label">Description</span>${tag('description')}
          <textarea class="input input--area" name="description" maxlength="4000" placeholder="A few words about it">${esc(v.description)}</textarea></label>

        <div class="field"><span class="field__label">Sizes</span>${tag('sizes')}
          <div class="list-box">
            ${(v.sizes || []).map((s, i) => `
              <div class="list-box__row"><input class="input input--plain" data-size="${i}" value="${esc(s.name)}" maxlength="20" aria-label="Size name">
                <button type="button" class="icon-btn icon-btn--small" data-del-size="${i}" aria-label="Delete size">${icons.trash}</button></div>`).join('') || '<p class="list-box__empty">One size only, or none yet.</p>'}
          </div>
          <button type="button" class="btn btn--secondary btn--block" data-add-size>${icons.plusCircle}<span>Add a size</span></button></div>

        <label class="field"><span class="field__label">Gauge</span>${tag('gauge')}
          <textarea class="input input--area input--short" name="gauge" maxlength="300" placeholder="e.g. 22 sts x 30 rows = 10 cm">${esc(v.gauge)}</textarea></label>

        <div class="field"><span class="field__label">Yarn</span>${tag('yarns')}
          <button type="button" class="yarn-card" data-yarns>
            <span class="yarn-card__head">${icons.yarn}<strong>Yarn requirements</strong>${icons.chevronRight}</span>
            ${(v.yarns || []).map((y, i) => `${i ? '<span class="or-line"><span>or</span></span>' : ''}
              <span class="yarn-card__item"><strong>${esc(yarnTitle(y))}</strong><span>${esc(yarnAmount(y))}</span></span>`).join('') || '<span class="yarn-card__empty">Tap to add the yarn this pattern needs.</span>'}
          </button></div>

        <div class="field"><span class="field__label">Tools and notions</span>${tag('tools')}
          <div class="tool-list">${(v.tools || []).map((t, i) => `<span class="tool">${esc(t)}<button type="button" data-del-tool="${i}" aria-label="Remove">${icons.close}</button></span>`).join('')}</div>
          <div class="tool-add"><input class="input" data-tool-input maxlength="120" placeholder="Add a needle, hook or notion">
            <button type="button" class="icon-btn icon-btn--round" data-add-tool aria-label="Add">${icons.plus}</button></div></div>

        <button class="btn btn--butter btn--block pform__save" type="submit">${editing ? 'Save changes' : 'Add pattern'}</button>
        ${editing ? `<button type="button" class="btn btn--danger-soft btn--block" data-delete>${icons.trash}<span>Delete pattern</span></button>` : ''}
      </form>`;
    paintCover();
    if (y) root.querySelector('.pform').scrollTop = y;
  }

  async function paintCover() {
    const box = root.querySelector('[data-cover-img]');
    if (!box) return;
    let u = null;
    if (pending.cover) { if (!coverPreview) coverPreview = URL.createObjectURL(pending.cover); u = coverPreview; }
    else if (!pending.removeCover) u = await coverUrl(v);
    if (u && box.isConnected) box.innerHTML = `<img src="${u}" alt="Cover">`;
  }

  /* ---------- fill in from a PDF ---------- */

  async function fillFromPdf(file) {
    if (!file) return;
    const prog = el(`
      <div class="reading" role="dialog" aria-modal="true" aria-label="Reading your pattern">
        <div class="reading__art">${icons.file}</div>
        <h2 class="reading__title">Reading your pattern</h2>
        <div class="file-card"><span class="file-card__icon">${icons.file}</span>
          <span class="file-card__text"><strong>${esc(file.name)}</strong><span>${kb(file.size)}</span></span></div>
        <ol class="steps">
          <li data-step="open"><span class="steps__mark"></span>Opening your PDF</li>
          <li data-step="pages"><span class="steps__mark"></span><span>Reading the pages</span></li>
          <li data-step="details"><span class="steps__mark"></span>Finding the details</li>
          <li data-step="form"><span class="steps__mark"></span>Getting your form ready</li>
        </ol>
        <p class="reading__note">All on your phone. Nothing is uploaded.</p>
        <p class="reading__time" data-elapsed>0:00</p>
      </div>`);
    document.body.appendChild(prog);
    const t0 = Date.now();
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      prog.querySelector('[data-elapsed]').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    const order = ['open', 'pages', 'details', 'form'];
    const mark = (step, info) => {
      const i = order.indexOf(step);
      prog.querySelectorAll('[data-step]').forEach((li, j) => {
        li.classList.toggle('is-done', j < i);
        li.classList.toggle('is-now', j === i);
      });
      if (step === 'pages' && info && info.of) prog.querySelector('[data-step="pages"] span:last-child').textContent = `Reading the pages (${info.page} of ${info.of})`;
    };
    try {
      const { readPatternPdf } = await import('../patterns/read-pdf.js');
      const r = await readPatternPdf(file, mark);
      const m = r.meta;
      const set = (field, value) => { if (value && (Array.isArray(value) ? value.length : true)) { v[field] = value; v.from_pdf[field] = true; } };
      set('name', m.name);
      set('designer', m.designer);
      set('description', m.description);
      set('gauge', m.gauge);
      if (m.sizes.length) set('sizes', m.sizes.map((name, pos) => ({ id: sid(), name, pos })));
      if (m.yarns.length) set('yarns', m.yarns.map((y) => ({ ...y, id: sid() })));
      if (m.tools.length) set('tools', m.tools);
      const cat = guessCategory(`${m.name} ${m.description}`);
      if (cat) set('category', cat);
      v.measurements = m.measurements;
      v.needles = m.needles;
      v.glossary = m.glossary;
      v.notes = m.notes;
      v.source_groups = r.sourceGroups;
      v.pdf_pages = r.pages;
      pending.pdf = file;
      pending.removePdf = false;
      if (r.cover && (!v.cover_file_id || v.from_pdf.cover)) {
        pending.cover = r.cover; pending.removeCover = false; v.from_pdf.cover = true;
        if (coverPreview) { URL.revokeObjectURL(coverPreview); coverPreview = null; }
      }
      mark('done');
      setTimeout(() => prog.remove(), 250);
      render();
      toast(m.instructionLines !== undefined || r.sourceGroups.length ? 'Filled in from your PDF. Check it over.' : 'Filled in what could be found. Check it over.', { ms: 3500 });
    } catch (e) {
      console.error(e);
      prog.remove();
      const why = String((e && (e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e && e.message || e)) || 'unknown').slice(0, 120);
      toast(`That PDF couldn’t be read. You can still fill the form in by hand. (${why})`, { ms: 9000 });
    } finally { clearInterval(tick); }
  }

  /* ---------- sheets ---------- */

  function categorySheet() {
    const body = el(`<div class="cat-sheet">
      <label class="search search--soft">${icons.search}<input type="search" placeholder="Search categories" data-q aria-label="Search categories"></label>
      <div class="cat-list" data-list></div></div>`);
    const sheet = openSheet({ title: 'Category', body, className: 'sheet--tall' });
    const paint = (q = '') => {
      body.querySelector('[data-list]').innerHTML = CATEGORIES.filter(([, label]) => label.toLowerCase().includes(q.toLowerCase())).map(([k, label]) => `
        <button type="button" class="cat-item ${v.category === k ? 'is-on' : ''}" data-cat="${k}">
          <span class="cat-item__icon">${categoryIcon(k)}</span><span>${esc(label)}</span>${v.category === k ? icons.check : ''}</button>`).join('')
        || '<p class="list-box__empty">Nothing matches. Try “Something else”.</p>';
    };
    paint();
    body.querySelector('[data-q]').addEventListener('input', (e) => paint(e.target.value));
    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]');
      if (!c) return;
      v.category = c.dataset.cat; delete v.from_pdf.category;
      sheet.close(); render();
    });
  }

  function yarnSheet() {
    const list = JSON.parse(JSON.stringify(v.yarns || []));
    const body = el('<form class="yarn-sheet" novalidate></form>');
    const sheet = openSheet({ title: 'Yarn requirements', body, className: 'sheet--tall' });
    const paint = () => {
      body.innerHTML = `${list.map((y, i) => `
        ${i ? '<p class="or-line"><span>or</span></p>' : ''}
        <fieldset class="yarn-edit" data-i="${i}">
          <div class="pform__two">
            <label class="field"><span class="field__label">Yarn name</span><input class="input" data-k="name" value="${esc(y.name || '')}" placeholder="e.g. Soft Merino"></label>
            <label class="field"><span class="field__label">Brand</span><input class="input" data-k="brand" value="${esc(y.brand || '')}"></label>
          </div>
          <div class="field"><span class="field__label">Weight</span><div class="chips chips--small">${WEIGHTS.map(([k, l]) => `<button type="button" class="chip ${y.weight === k ? 'is-on' : ''}" data-weight="${k}">${l}</button>`).join('')}</div></div>
          <div class="pform__three">
            <label class="field"><span class="field__label">Length from</span><input class="input" data-k="length_min" inputmode="numeric" value="${esc(String(y.length_min ?? ''))}"></label>
            <label class="field"><span class="field__label">to</span><input class="input" data-k="length_max" inputmode="numeric" value="${esc(String(y.length_max ?? ''))}"></label>
            <div class="field"><span class="field__label">Unit</span><div class="chips chips--small">${['m', 'yd'].map((u) => `<button type="button" class="chip ${(y.length_unit || 'm') === u ? 'is-on' : ''}" data-unit="${u}">${u}</button>`).join('')}</div></div>
          </div>
          <div class="pform__two">
            <label class="field"><span class="field__label">Total grams</span><input class="input" data-k="grams_text" value="${esc(y.grams_text || '')}" placeholder="e.g. 100 (150) 200 g"></label>
            <label class="field"><span class="field__label">Skeins</span><input class="input" data-k="skeins_text" value="${esc(y.skeins_text || '')}" placeholder="e.g. 2 (3) 4"></label>
          </div>
          <label class="field"><span class="field__label">Fibre</span><input class="input" data-k="fibre" value="${esc(y.fibre || '')}" placeholder="e.g. wool, alpaca"></label>
          <label class="field"><span class="field__label">Notes</span><input class="input" data-k="notes" value="${esc(y.notes || '')}" placeholder="e.g. 50 g = 150 m"></label>
          <button type="button" class="btn btn--danger-soft btn--small" data-del-yarn>${icons.trash}<span>Remove this yarn</span></button>
        </fieldset>`).join('')}
        <button type="button" class="btn btn--secondary btn--block" data-add-yarn>${icons.plusCircle}<span>${list.length ? 'Add another yarn (or)' : 'Add a yarn'}</span></button>
        <button type="submit" class="btn btn--butter btn--block">Done</button>`;
    };
    paint();
    body.addEventListener('input', (e) => {
      const fs = e.target.closest('[data-i]'); const k = e.target.dataset.k;
      if (!fs || !k) return;
      const y = list[+fs.dataset.i];
      y[k] = /^length_/.test(k) ? (parseFloat(e.target.value) || null) : e.target.value;
      if (k === 'grams_text') y.grams = (e.target.value.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => parseFloat(n.replace(',', '.')));
    });
    body.addEventListener('click', (e) => {
      const fs = e.target.closest('[data-i]');
      const y = fs ? list[+fs.dataset.i] : null;
      if (e.target.closest('[data-weight]')) { y.weight = e.target.closest('[data-weight]').dataset.weight; paint(); }
      if (e.target.closest('[data-unit]')) { y.length_unit = e.target.closest('[data-unit]').dataset.unit; paint(); }
      if (e.target.closest('[data-del-yarn]')) { list.splice(+fs.dataset.i, 1); paint(); }
      if (e.target.closest('[data-add-yarn]')) { list.push({ id: sid(), name: '', brand: '', weight: '', grams: [], grams_text: '', length_unit: 'm' }); paint(); }
    });
    body.addEventListener('submit', (e) => { e.preventDefault(); v.yarns = list; delete v.from_pdf.yarns; sheet.close(); render(); });
  }

  async function coverSheet() {
    const src = pending.pdf || (v.pdf_file_id && !pending.removePdf ? await pdfBlob(v) : null);
    const body = el(`<div class="cover-sheet">
      ${src ? '<p class="settings__p">Use a page of the PDF:</p><div class="page-thumbs" data-thumbs><p class="list-box__empty">Drawing the pages…</p></div>' : ''}
      <button type="button" class="btn btn--secondary btn--block" data-photo>${icons.camera}<span>Use a photo instead</span></button></div>`);
    const sheet = openSheet({ title: 'Cover picture', body, className: 'sheet--tall' });
    body.querySelector('[data-photo]').addEventListener('click', () => {
      sheet.close();
      pickPhoto(async (file) => {
        try {
          const { full } = await shrinkPhoto(file);
          pending.cover = full.blob; pending.removeCover = false; delete v.from_pdf.cover;
          if (coverPreview) { URL.revokeObjectURL(coverPreview); coverPreview = null; }
          render();
        } catch { toast('That photo couldn’t be opened.'); }
      }, { title: 'Cover photo' });
    });
    if (!src) return;
    const { openPdf, renderPage, pageToJpeg, closePdf } = await import('../patterns/pdf.js');
    const doc = await openPdf(src);
    const box = body.querySelector('[data-thumbs]');
    box.innerHTML = '';
    for (let n = 1; n <= doc.numPages && box.isConnected; n++) {
      const b = el(`<button type="button" class="page-thumb" data-page="${n}" aria-label="Page ${n}"><span>Page ${n}</span></button>`);
      box.appendChild(b);
      const c = await renderPage(doc, n, 96, undefined, 400000);
      b.prepend(c);
    }
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      pending.cover = await pageToJpeg(doc, +b.dataset.page, 900, 0.82);
      pending.removeCover = false; delete v.from_pdf.cover;
      if (coverPreview) { URL.revokeObjectURL(coverPreview); coverPreview = null; }
      sheet.close(); render();
    });
    const obs = new MutationObserver(() => { if (!body.isConnected) { closePdf(doc); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- events ---------- */

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (['name', 'designer', 'description', 'gauge'].includes(t.name)) {
      v[t.name] = t.value;
      if (t.name === 'name') root.querySelector('[data-name-error]').hidden = true;
    }
    if (t.dataset.size != null) v.sizes[+t.dataset.size].name = t.value;
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-fill]')) { const f = t.files[0]; t.value = ''; fillFromPdf(f); }
    if (t.matches('[data-attach]')) {
      const f = t.files[0]; t.value = '';
      if (f) {
        pending.pdf = f; pending.removePdf = false; render();
        import('../patterns/pdf.js').then(async ({ openPdf, closePdf }) => { const d = await openPdf(f); v.pdf_pages = d.numPages; closePdf(d); render(); }).catch(() => {});
      }
    }
  });
  root.addEventListener('click', async (e) => {
    const t = e.target;
    const hit = (sel) => t.closest(sel);
    if (hit('[data-craft]')) { v.craft = hit('[data-craft]').dataset.craft; render(); }
    else if (hit('[data-diff]')) { v.difficulty = hit('[data-diff]').dataset.diff; render(); }
    else if (hit('[data-category]')) categorySheet();
    else if (hit('[data-yarns]')) yarnSheet();
    else if (hit('[data-cover]')) coverSheet();
    else if (hit('[data-remove-cover]')) { pending.cover = null; pending.removeCover = true; delete v.from_pdf.cover; render(); }
    else if (hit('[data-remove-pdf]')) { pending.pdf = null; pending.removePdf = true; render(); }
    else if (hit('[data-preview]')) {
      const blob = pending.pdf || await pdfBlob(v);
      if (blob) { const { openPdfOverlay } = await import('./pdf-viewer.js'); openPdfOverlay({ blob, title: v.name }); }
      else toast('The PDF isn’t on this device yet.');
    }
    else if (hit('[data-add-size]')) { v.sizes = [...(v.sizes || []), { id: sid(), name: '', pos: null }]; render(); root.querySelector(`[data-size="${v.sizes.length - 1}"]`)?.focus(); }
    else if (hit('[data-del-size]')) {
      const i = +hit('[data-del-size]').dataset.delSize;
      v.sizes.splice(i, 1); delete v.from_pdf.sizes; render();
    }
    else if (hit('[data-add-tool]')) {
      const inp = root.querySelector('[data-tool-input]');
      if (inp.value.trim()) { v.tools = [...(v.tools || []), inp.value.trim()]; render(); root.querySelector('[data-tool-input]').focus(); }
    }
    else if (hit('[data-del-tool]')) { v.tools.splice(+hit('[data-del-tool]').dataset.delTool, 1); render(); }
    else if (hit('[data-delete]')) {
      const ok = await confirmDialog({
        title: `Delete “${pattern.name}”?`,
        message: 'The pattern, its PDF and its guides are removed from all your devices. Projects that use it stay, just without the pattern.',
        ok: 'Delete pattern', danger: true,
      });
      if (!ok) return;
      await deletePattern(pattern.id);
      saved = true;
      toast('Pattern deleted');
      location.hash = '#/patterns';
    }
    else if (hit('[data-cancel]')) {
      saved = true;
      location.hash = editing ? `#/pattern/${pattern.id}` : '#/patterns';
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-tool-input]')) { e.preventDefault(); root.querySelector('[data-add-tool]').click(); }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    v.name = (v.name || '').trim();
    if (!v.name) { root.querySelector('[data-name-error]').hidden = false; root.querySelector('[name=name]').focus(); return; }
    v.sizes = (v.sizes || []).filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() }));
    const btn = root.querySelector('.pform__save');
    btn.disabled = true;
    try {
      Object.assign(pattern, v);
      if (pending.pdf) {
        await setPatternPdf(pattern, pending.pdf);
        Object.assign(pattern, { pdf_name: pending.pdf.name, pdf_size: pending.pdf.size, pdf_pages: v.pdf_pages || 0 });
      } else if (pending.removePdf) await removePatternPdf(pattern);
      if (pending.cover) await setPatternCover(pattern, pending.cover);
      else if (pending.removeCover) await removePatternCover(pattern);
      await savePattern(pattern);
      // New pattern read from a PDF: build its step-by-step guides right away.
      if (!editing) { try { pattern.auto_guides = await autoGuides(pattern); } catch (e) { console.warn(e); } }
      saved = true;
      if (editing) { toast('Changes saved'); location.hash = `#/pattern/${pattern.id}`; return; }
      addedScreen(pattern);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Couldn’t save the pattern. Is the phone’s storage full?');
    }
  });

  function addedScreen(p) {
    root.innerHTML = `
      <main class="added">
        <div class="added__badge">${icons.check}</div>
        <h1 class="added__title">Pattern added</h1>
        <p class="added__name">${esc(p.name)}</p>
        <p class="settings__p">It’s in your patterns now${p.pdf_file_id ? ', with its PDF' : ''}. ${p.auto_guides ? `Step-by-step guide${p.auto_guides > 1 ? 's' : ''} ready for ${p.auto_guides > 1 ? `all ${p.auto_guides} sizes` : 'it'}, so you can start right away. ` : ''}Start knitting it, or have a look first.</p>
        <div class="added__actions">
          <button type="button" class="btn btn--butter btn--block" data-start>${icons.play}<span>Start a project</span></button>
          <a class="btn btn--secondary btn--block" href="#/pattern/${p.id}">View pattern</a>
        </div>
      </main>`;
    root.querySelector('[data-start]').addEventListener('click', () => startProjectFrom(p));
  }

  render();
  return () => { if (coverPreview) URL.revokeObjectURL(coverPreview); void saved; void db; };
}
