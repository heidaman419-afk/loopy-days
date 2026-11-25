// Patterns tab (#/patterns): category chips, search and a 2-column grid of pattern cards.

import { icons } from '../ui/icons.js';
import { esc } from '../ui/dom.js';
import { listPatterns, coverUrl, categoryGroup, CATEGORY_GROUPS } from '../data/patterns.js';
import { groupIcon } from '../patterns/ui.js';

const VIEW = 'ld-patterns-view';

export async function mount(root) {
  let group = localStorage.getItem(VIEW) || 'all';
  let query = '';
  let items = [];

  root.innerHTML = `
    <header class="wave-head wave-head--tall">
      <div class="wave-head__bar">
        <div class="wave-head__side"></div>
        <div class="wave-head__brand"><span class="pat-mark">${icons.patterns}</span></div>
        <div class="wave-head__side wave-head__side--right">
          <a class="icon-btn icon-btn--round" href="#/pattern-new" aria-label="Add a pattern">${icons.plus}</a>
        </div>
      </div>
      <h1 class="wave-head__title">Your patterns</h1>
      <div class="search-row search-row--one">
        <label class="search">${icons.search}
          <input type="search" placeholder="Search patterns or designers" aria-label="Search patterns" data-search autocomplete="off" enterkeyhint="search"></label>
      </div>
      <div class="cat-chips" role="tablist" aria-label="Categories" data-chips>
        ${CATEGORY_GROUPS.map(([k, label]) => `
          <button type="button" class="cat-chip ${group === k ? 'is-on' : ''}" data-group="${k}" role="tab" aria-selected="${group === k}">
            <span class="cat-chip__icon">${groupIcon(k)}</span>${esc(label)}</button>`).join('')}
      </div>
      <svg class="wave-head__wave" viewBox="0 0 390 34" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0H390V16C352 26 318 30 268 22 212 13 170 4 118 10 70 15 34 30 0 22Z"/>
      </svg>
    </header>
    <main class="page patterns-page">
      <p class="list-note" data-note hidden></p>
      <div class="patgrid" data-grid></div>
      <section class="empty" data-empty hidden>
        <div class="empty__art" aria-hidden="true">${icons.patterns}</div>
        <h2 class="empty__title">Your pattern shelf is empty</h2>
        <p class="empty__text">Add a pattern PDF and Loopy Days reads it on your phone, then turns it into steps you can follow row by row.</p>
        <a class="btn btn--butter" href="#/pattern-new">${icons.plus}<span>Add a pattern</span></a>
      </section>
    </main>`;

  const grid = root.querySelector('[data-grid]');

  function visible() {
    const q = query.trim().toLowerCase();
    return items.filter((p) => (group === 'all' || categoryGroup(p.category) === group)
      && (!q || `${p.name} ${p.designer}`.toLowerCase().includes(q)));
  }

  async function paint() {
    const list = visible();
    root.querySelector('[data-empty]').hidden = items.length > 0;
    const note = root.querySelector('[data-note]');
    note.hidden = !(items.length && !list.length);
    if (!note.hidden) note.innerHTML = `Nothing here yet. <button type="button" class="link-btn" data-all>Show all patterns</button>`;
    grid.innerHTML = list.map((p) => `
      <a class="patcard" href="#/pattern/${p.id}">
        <span class="patcard__img knit-texture" data-cover="${p.id}">${p.cover_file_id ? '' : `<span class="patcard__ph">${groupIcon(categoryGroup(p.category))}</span>`}</span>
        <span class="patcard__body"><strong>${esc(p.name || 'Untitled pattern')}</strong><span>${esc(p.designer || '')}</span></span>
      </a>`).join('');
    for (const p of list) {
      const u = await coverUrl(p);
      const box = grid.querySelector(`[data-cover="${p.id}"]`);
      if (u && box) box.innerHTML = `<img src="${u}" alt="">`;
    }
  }

  async function refresh() { items = await listPatterns(); if (root.isConnected) paint(); }

  root.querySelector('[data-search]').addEventListener('input', (e) => { query = e.target.value; paint(); });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-group]');
    if (c) {
      group = c.dataset.group; localStorage.setItem(VIEW, group);
      root.querySelectorAll('[data-group]').forEach((b) => { const on = b === c; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
      paint();
    }
    if (e.target.closest('[data-all]')) { group = 'all'; query = ''; root.querySelector('[data-search]').value = ''; refreshChips(); paint(); }
  });
  function refreshChips() { root.querySelectorAll('[data-group]').forEach((b) => b.classList.toggle('is-on', b.dataset.group === group)); }

  const onData = () => refresh();
  window.addEventListener('ld:data-changed', onData);
  window.addEventListener('ld:files-changed', onData);
  await refresh();
  return () => { window.removeEventListener('ld:data-changed', onData); window.removeEventListener('ld:files-changed', onData); };
}
