// Dialogs and sheets used by the counter screen: goal, row notes, extra counters.

import { openDialog, openSheet, confirmDialog } from '../ui/overlay.js';
import { el, esc } from '../ui/dom.js';
import { icons } from '../ui/icons.js';

const digitsOnly = (input) => input.addEventListener('input', () => {
  const v = input.value.replace(/\D/g, '').slice(0, 6);
  if (v !== input.value) input.value = v;
});

/* ---------------- Goal ---------------- */

/** Resolves to a number, 0 to clear, or null if cancelled. */
export function goalDialog(counter) {
  return new Promise((resolve) => {
    let answer = null;
    const noun = counter.name.toLowerCase();
    const d = openDialog({
      title: 'Set a goal',
      className: 'dialog--goal',
      body: `
        <label class="field">
          <span class="field__label">How many ${esc(noun)} are you aiming for?</span>
          <input class="input input--big" type="text" inputmode="numeric" pattern="[0-9]*"
            autocomplete="off" enterkeyhint="done" placeholder="e.g. 40" value="${counter.target || ''}">
        </label>`,
      actions: [
        { label: 'Set goal', kind: 'primary', onClick: () => {
          const n = parseInt(input.value, 10);
          if (!(n > 0)) { input.classList.add('is-wrong'); input.focus(); return false; }
          answer = n;
        } },
        { label: 'Clear', kind: 'text', onClick: () => { answer = 0; } },
        { label: 'Cancel', kind: 'text' },
      ],
      onClose: () => resolve(answer),
    });
    const input = d.body.querySelector('input');
    const setBtn = d.root.querySelector('.btn--primary');
    const sync = () => { setBtn.disabled = !input.value; input.classList.remove('is-wrong'); };
    digitsOnly(input);
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setBtn.click(); } });
    sync();
    requestAnimationFrame(() => input.focus());
  });
}

/* ---------------- Row notes ---------------- */

/**
 * model: ProjectCounters. save(entries) persists. onChange() repaints the strip.
 */
export function notesSheet(model, save, onChange) {
  const body = el('<div class="notes"></div>');

  const render = () => {
    const next = Math.max(1, model.main.value + 1);
    body.innerHTML = `
      <form class="note-form" autocomplete="off">
        <p class="settings__p">Leave yourself a message for a certain row, like "start the decreases" or "change colour". It pops up when your count gets there.</p>
        <div class="note-form__row">
          <label class="field field--row">
            <span class="field__label">Row</span>
            <input class="input" name="row" type="text" inputmode="numeric" pattern="[0-9]*" value="${next}" required>
          </label>
          <label class="field field--grow">
            <span class="field__label">Note</span>
            <input class="input" name="text" type="text" maxlength="140" placeholder="What to remember" autocapitalize="sentences" required>
          </label>
        </div>
        <button class="btn btn--pink btn--block" type="submit">${icons.plus}<span>Add note</span></button>
      </form>
      <h3 class="settings__h4">${model.notes.length ? 'Your notes' : 'No notes yet'}</h3>
      <ul class="note-list">
        ${model.notes.map((n) => `
          <li class="note-item ${n.done ? 'is-done' : ''} ${n.row <= model.main.value && !n.done ? 'is-due' : ''}" data-id="${n.id}">
            <button type="button" class="note-item__check" data-done aria-pressed="${n.done}" aria-label="${n.done ? 'Mark as not done' : 'Mark as done'}">${n.done ? icons.check : ''}</button>
            <span class="note-item__row">Row ${n.row}</span>
            <span class="note-item__text">${esc(n.text)}</span>
            <button type="button" class="icon-btn icon-btn--small" data-del aria-label="Delete note">${icons.trash}</button>
          </li>`).join('')}
      </ul>`;
    digitsOnly(body.querySelector('[name=row]'));
  };

  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const row = parseInt(f.row.value, 10);
    const text = f.text.value.trim();
    if (!(row > 0)) { f.row.classList.add('is-wrong'); f.row.focus(); return; }
    if (!text) { f.text.classList.add('is-wrong'); f.text.focus(); return; }
    const n = model.addNote(row, text);
    save([['row_notes', n]]);
    render(); onChange();
  });
  body.addEventListener('click', (e) => {
    const li = e.target.closest('.note-item');
    if (!li) return;
    const n = model.notes.find((x) => x.id === li.dataset.id);
    if (!n) return;
    if (e.target.closest('[data-done]')) {
      n.done = !n.done;
      save([['row_notes', n]]);
    } else if (e.target.closest('[data-del]')) {
      model.removeNote(n);
      save([['row_notes', n]]);
    } else return;
    render(); onChange();
  });

  render();
  return openSheet({ title: 'Row notes & reminders', body, className: 'sheet--tall' });
}

/* ---------------- Extra counters ---------------- */

const SUGGEST = ['Stitches', 'Repeats', 'Pattern rows', 'Increases', 'Decreases'];

/**
 * counter: an existing extra counter to edit, or null to add one.
 * Resolves to { action: 'save', name, resetWithMain } | { action: 'reset' } | { action: 'remove' } | null.
 */
export function extraCounterSheet(counter) {
  return new Promise((resolve) => {
    let answer = null;
    const body = el(`
      <form class="extra-form" autocomplete="off">
        <label class="field">
          <span class="field__label">Name</span>
          <input class="input" name="name" type="text" maxlength="24" autocapitalize="sentences"
            placeholder="Stitches, repeats…" value="${esc(counter ? counter.name : '')}" required>
        </label>
        <div class="chips chips--small">
          ${SUGGEST.map((s) => `<button type="button" class="chip" data-suggest="${s}">${s}</button>`).join('')}
        </div>
        <label class="settings__row settings__row--box">
          <span>
            <strong>Back to 0 on each new row</strong>
            <span class="settings__p">Starts over every time the main count goes up. Good for stitches within a row.</span>
          </span>
          <span class="switch">
            <input type="checkbox" name="reset" ${counter && counter.reset_with_main ? 'checked' : ''}>
            <span class="switch__track"><span class="switch__dot"></span></span>
          </span>
        </label>
        <button class="btn btn--butter btn--block" type="submit">${counter ? 'Save changes' : 'Add counter'}</button>
        ${counter ? `
          <div class="extra-form__more">
            <button type="button" class="btn btn--secondary" data-reset>${icons.reset}<span>Back to 0</span></button>
            <button type="button" class="btn btn--danger-soft" data-remove>${icons.trash}<span>Remove</span></button>
          </div>` : ''}
      </form>`);

    const sheet = openSheet({
      title: counter ? `Edit ${counter.name}` : 'Add a counter',
      body,
      onClose: () => resolve(answer),
    });
    const f = body;
    f.addEventListener('click', async (e) => {
      const s = e.target.closest('[data-suggest]');
      if (s) { f.name.value = s.dataset.suggest; f.name.classList.remove('is-wrong'); return; }
      if (e.target.closest('[data-reset]')) { answer = { action: 'reset' }; sheet.close(); return; }
      if (e.target.closest('[data-remove]')) {
        const ok = await confirmDialog({
          title: `Remove ${counter.name}?`,
          message: 'This little counter and its count will be removed.',
          ok: 'Remove', danger: true,
        });
        if (ok) { answer = { action: 'remove' }; sheet.close(); }
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = f.name.value.trim();
      if (!name) { f.name.classList.add('is-wrong'); f.name.focus(); return; }
      answer = { action: 'save', name, resetWithMain: f.reset.checked };
      sheet.close();
    });
    if (!counter) requestAnimationFrame(() => f.name.focus());
  });
}
