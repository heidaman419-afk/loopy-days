// Bottom sheets, centred dialogs and toasts.
// Opening/closing uses `click` (not pointerdown) so one finger can't open
// something and also hit a button inside it.

import { el, esc } from './dom.js';
import { icons } from './icons.js';

const stack = [];

function root() {
  let r = document.getElementById('overlay-root');
  if (!r) {
    r = document.createElement('div');
    r.id = 'overlay-root';
    document.body.appendChild(r);
  }
  return r;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

function mount(node, { onClose, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  root().appendChild(node);
  let closed = false;
  const api = {
    root: node,
    close(result) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      node.classList.add('is-closing');
      setTimeout(() => node.remove(), 160);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch {}
      onClose && onClose(result);
    },
  };
  if (dismissable) {
    node.addEventListener('click', (e) => { if (e.target === node) api.close(); });
  }
  stack.push(api);
  return api;
}

export function closeAll() {
  while (stack.length) stack[stack.length - 1].close();
}

/** Bottom sheet with a title bar and a close button. body: Element or HTML string. */
export function openSheet({ title, body, onClose, className = '' }) {
  const node = el(`
    <div class="scrim scrim--sheet" role="presentation">
      <section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__grab" aria-hidden="true"></div>
        <header class="sheet__head">
          <button class="icon-btn sheet__close" type="button" aria-label="Close">${icons.close}</button>
          <h2 class="sheet__title">${esc(title)}</h2>
          <span class="sheet__spacer"></span>
        </header>
        <div class="sheet__body"></div>
      </section>
    </div>`);
  const bodyEl = node.querySelector('.sheet__body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const api = mount(node, { onClose });
  node.querySelector('.sheet__close').addEventListener('click', () => api.close());
  api.body = bodyEl;
  return api;
}

/**
 * Centred dialog.
 * actions: [{ label, kind: 'primary'|'secondary'|'text'|'danger', onClick(api) -> false keeps it open }]
 */
export function openDialog({ title, body = '', actions = [], onClose, dismissable = true, className = '' }) {
  const node = el(`
    <div class="scrim scrim--center" role="presentation">
      <section class="dialog ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        ${title ? `<h2 class="dialog__title">${esc(title)}</h2>` : ''}
        <div class="dialog__body"></div>
        <div class="dialog__actions"></div>
      </section>
    </div>`);
  const bodyEl = node.querySelector('.dialog__body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const api = mount(node, { onClose, dismissable });
  api.body = bodyEl;
  const bar = node.querySelector('.dialog__actions');
  for (const a of actions) {
    const b = el(`<button type="button" class="btn btn--${a.kind || 'secondary'}">${a.html || esc(a.label)}</button>`);
    b.addEventListener('click', () => {
      const keep = a.onClick ? a.onClick(api) : undefined;
      if (keep !== false) api.close(a.result);
    });
    bar.appendChild(b);
    a.node = b;
  }
  return api;
}

export function confirmDialog({ title, message, ok = 'Yes', cancel = 'Keep it', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openDialog({
      title,
      body: `<p class="dialog__text">${esc(message)}</p>`,
      actions: [
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { answer = true; } },
        { label: cancel, kind: 'text' },
      ],
      onClose: () => resolve(answer),
    });
  });
}

/** One-field text/number prompt. Resolves to the string, or null when cancelled. */
export function promptDialog({ title, label, value = '', placeholder = '', numeric = false, ok = 'Save', maxlength = 40 }) {
  return new Promise((resolve) => {
    let answer = null;
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    const d = openDialog({
      title,
      body: `
        <label class="field">
          <span class="field__label">${esc(label)}</span>
          <input id="${id}" class="input" ${numeric ? 'type="text" inputmode="numeric" pattern="[0-9]*"' : 'type="text" autocapitalize="sentences"'}
            maxlength="${maxlength}" autocomplete="off" enterkeyhint="done" placeholder="${esc(placeholder)}" value="${esc(value)}">
        </label>`,
      actions: [
        { label: ok, kind: 'primary', onClick: () => { answer = d.body.querySelector('input').value.trim(); } },
        { label: 'Cancel', kind: 'text' },
      ],
      onClose: () => resolve(answer),
    });
    const input = d.body.querySelector('input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); answer = input.value.trim(); d.close(); }
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

let toastTimer = null;
export function toast(message, { ms = 2600, icon = '' } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('<div id="toast" class="toast" role="status" aria-live="polite"></div>');
    document.body.appendChild(t);
  }
  t.innerHTML = `${icon}<span>${esc(message)}</span>`;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
}
