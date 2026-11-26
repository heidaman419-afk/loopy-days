// Pattern page (#/pattern/<id>): cover, details, PDF, sizes, gauge, yarn, tools, guides,
// projects using it, duplicate / delete, and "Start a project".

import * as db from '../db.js';
import { icons } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { confirmDialog, toast } from '../ui/overlay.js';
import {
  getPattern, coverUrl, pdfBlob, hasLocalPdf, setPatternPdf, savePattern, deletePattern, duplicatePattern,
  categoryLabel, difficultyLabel, guidesOf,
} from '../data/patterns.js';
import { craftLabel, statusOf, statusLabel } from '../data/projects.js';
import { categoryIcon, yarnListHTML } from '../patterns/ui.js';
import { startProjectFrom } from '../patterns/start-project.js';

export const fullscreen = true;

export async function mount(root, params) {
  let p = await getPattern(params[0]);
  if (!p) { location.hash = '#/patterns'; return; }
  let url = null;

  async function paint() {
    p = await getPattern(p.id);
    if (!p) { location.hash = '#/patterns'; return; }
    const guides = (await guidesOf(p.id)).filter((g) => !g.deleted);
    const projects = (await db.getAll('projects')).filter((x) => x.pattern_id === p.id && !x.draft);
    const local = await hasLocalPdf(p);
    const sizes = p.sizes || [];
    const sizeRows = (sizes.length ? sizes : [{ id: null, name: 'One size' }]).map((s) => {
      const g = guides.find((x) => (x.size_id || null) === (s.id || null));
      const st = g ? (g.status === 'ready' ? 'ready' : 'draft') : 'none';
      return `<div class="gsize">
        <span class="gsize__name">${esc(s.name)}</span>
        <span class="gsize__state gsize__state--${st}">${st === 'ready' ? `${icons.check}Guide ready · ${g.total_rows || 0} rows` : st === 'draft' ? 'Draft in progress' : 'No guide yet'}</span>
        <a class="btn btn--small ${st === 'none' ? 'btn--pink' : 'btn--secondary'}" href="${g ? `#/guide-edit/${g.id}` : `#/guide-size/${p.id}/${s.id || 'one'}`}">${st === 'none' ? 'Build guide' : 'Edit'}</a>
      </div>`;
    }).join('');
    root.innerHTML = `
      <header class="pat-hero">
        <div class="pat-hero__img knit-texture" data-cover>${p.cover_file_id ? '' : `<span class="pat-hero__ph">${categoryIcon(p.category)}</span>`}</div>
        <div class="pat-hero__bar">
          <a class="icon-btn icon-btn--round" href="#/patterns" aria-label="Back to patterns">${icons.back}</a>
          <a class="btn btn--small btn--secondary" href="#/pattern-edit/${p.id}">${icons.pencil}<span>Edit</span></a>
        </div>
      </header>
      <main class="pat-page">
        <h1 class="pat-page__name">${esc(p.name)}</h1>
        ${p.designer ? `<p class="pat-page__by">by ${esc(p.designer)}</p>` : ''}
        <div class="pat-tags">
          <span class="pat-tag">${esc(craftLabel(p.craft || 'knitting'))}</span>
          ${p.category ? `<span class="pat-tag">${categoryIcon(p.category)}${esc(categoryLabel(p.category))}</span>` : ''}
          ${p.difficulty ? `<span class="pat-tag">${esc(difficultyLabel(p.difficulty))}</span>` : ''}
        </div>
        ${p.description ? `<details class="readmore"><summary><p class="readmore__text">${esc(p.description)}</p><span class="readmore__more">Read more</span></summary></details>` : ''}

        <section class="psec">
          <h2 class="sec-title">${icons.file}<span>PDF</span></h2>
          ${p.pdf_file_id ? `
          <div class="pdf-card">
            <div class="file-card"><span class="file-card__icon">${icons.file}</span>
              <span class="file-card__text"><strong>${esc(p.pdf_name || 'Pattern.pdf')}</strong><span>${p.pdf_pages ? `${p.pdf_pages} pages · ` : ''}${local ? 'On this device' : 'Online, opens when you need it'}</span></span></div>
            <div class="pdf-card__actions">
              <a class="btn btn--butter btn--small" href="#/pdf/${p.id}">${icons.expand}<span>View PDF</span></a>
              <label class="btn btn--secondary btn--small">${icons.repeat}<span>Replace</span><input type="file" accept="application/pdf,.pdf" data-replace hidden></label>
              <button type="button" class="btn btn--secondary btn--small" data-download>${icons.download}<span>Save a copy</span></button>
            </div>
          </div>` : `<a class="dash-box dash-box--small" href="#/pattern-edit/${p.id}">${icons.file}<strong>No PDF yet</strong><span>Attach one in Edit</span></a>`}
        </section>

        ${(p.notes || []).length ? `
        <section class="psec">
          <h2 class="sec-title">${icons.info}<span>Read first</span></h2>
          ${(p.notes || []).map((n) => `<details class="note-fold"><summary>${esc(n.title || 'Note')}</summary><p>${esc(n.text)}</p></details>`).join('')}
        </section>` : ''}

        <section class="psec">
          <h2 class="sec-title">${icons.ruler}<span>Sizes</span></h2>
          ${sizes.length ? `<div class="chips">${sizes.map((s) => `<span class="chip chip--static">${esc(s.name)}</span>`).join('')}</div>` : '<p class="settings__p">One size.</p>'}
          ${(p.measurements || []).map((m) => `<p class="kv"><strong>${esc(m.label)}</strong><span>${esc(m.value)}</span></p>`).join('')}
        </section>

        ${p.gauge ? `<section class="psec"><h2 class="sec-title">${icons.grid}<span>Gauge</span></h2><p class="info-card">${esc(p.gauge)}</p></section>` : ''}

        <section class="psec">
          <h2 class="sec-title">${icons.yarn}<span>Yarn</span></h2>
          ${(p.yarns || []).length ? `<div class="yarn-card yarn-card--static">${yarnListHTML(p.yarns, { notes: true })}</div>` : '<p class="settings__p">No yarn noted yet.</p>'}
        </section>

        ${(p.tools || []).length ? `<section class="psec"><h2 class="sec-title">${icons.tools}<span>Tools and notions</span></h2>
          <ul class="plain-list">${p.tools.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}

        ${(p.glossary || []).length ? `<section class="psec"><details class="note-fold"><summary>${icons.list} Abbreviations (${p.glossary.length})</summary>
          <dl class="glossary">${p.glossary.map((g) => `<dt>${esc(g.abbr)}</dt><dd>${esc(g.meaning)}</dd>`).join('')}</dl></details></section>` : ''}

        <section class="psec">
          <h2 class="sec-title">${icons.patterns}<span>Pattern guide</span></h2>
          <p class="settings__p">${guides.filter((g) => g.status === 'ready').length} ${guides.filter((g) => g.status === 'ready').length === 1 ? 'guide' : 'guides'} built · ${Math.max(1, sizes.length)} ${Math.max(1, sizes.length) === 1 ? 'size' : 'sizes'}</p>
          <div class="gsizes">${sizeRows}</div>
        </section>

        <section class="psec">
          <h2 class="sec-title">${icons.projects}<span>Projects using it</span></h2>
          ${projects.length ? `<div class="mini-links">${projects.map((x) => `<a href="#/project/${x.id}" class="mini-link"><strong>${esc(x.name)}</strong><span>${esc(statusLabel(statusOf(x)))}</span>${icons.chevronRight}</a>`).join('')}</div>` : '<p class="settings__p">None yet.</p>'}
        </section>

        <section class="psec pat-actions">
          <button type="button" class="btn btn--secondary" data-dup>${icons.copy}<span>Duplicate</span></button>
          <button type="button" class="btn btn--danger-soft" data-del>${icons.trash}<span>Delete</span></button>
        </section>
      </main>
      <footer class="knit-bar">
        <button type="button" class="knit-bar__go" data-start><span class="knit-bar__label">${icons.play}<span>Start a project</span></span>
          <span class="knit-bar__sub">${esc(p.name)}</span></button>
      </footer>`;
    const u = await coverUrl(p);
    if (u) root.querySelector('[data-cover]').innerHTML = `<img src="${u}" alt="">`;
  }

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-start]')) startProjectFrom(p);
    if (e.target.closest('[data-dup]')) {
      const c = await duplicatePattern(p.id);
      if (c) { toast('Pattern copied'); location.hash = `#/pattern/${c.id}`; }
    }
    if (e.target.closest('[data-del]')) {
      const ok = await confirmDialog({
        title: `Delete “${p.name}”?`,
        message: 'The pattern, its PDF and its guides are removed from all your devices. Projects that use it stay, just without the pattern.',
        ok: 'Delete pattern', danger: true,
      });
      if (!ok) return;
      await deletePattern(p.id);
      toast('Pattern deleted');
      location.hash = '#/patterns';
    }
    if (e.target.closest('[data-download]')) {
      const blob = await pdfBlob(p);
      if (!blob) { toast('The PDF isn’t on this device yet. Try when you’re online.'); return; }
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = p.pdf_name || `${p.name}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
    }
  });
  root.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-replace]')) return;
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    await setPatternPdf(p, f);
    Object.assign(p, { pdf_name: f.name, pdf_size: f.size });
    try { const { openPdf, closePdf } = await import('../patterns/pdf.js'); const d = await openPdf(f); p.pdf_pages = d.numPages; closePdf(d); } catch {}
    await savePattern(p);
    toast('PDF replaced');
    paint();
  });

  const onData = () => paint();
  window.addEventListener('ld:data-changed', onData);
  window.addEventListener('ld:files-changed', onData);
  await paint();
  return () => {
    window.removeEventListener('ld:data-changed', onData);
    window.removeEventListener('ld:files-changed', onData);
    if (url) URL.revokeObjectURL(url);
  };
}
