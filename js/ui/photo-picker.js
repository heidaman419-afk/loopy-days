// "Add a photo" sheet (take one or choose one) and the full-screen photo viewer.
// The choices are <label>s wrapping file inputs, so iPhone Safari opens the camera
// or library straight from the tap (no lost user gesture).

import { openSheet, confirmDialog, toast } from './overlay.js';
import { el } from './dom.js';
import { icons } from './icons.js';

/** onFile(file) is called with the picked image (once). */
export function pickPhoto(onFile, { title = 'Add a photo' } = {}) {
  const body = el(`
    <div class="pick">
      <p class="settings__p">Take one now or pick one you already have. It’s made smaller on this phone before it’s saved.</p>
      <label class="pick__choice">
        <span class="pick__icon">${icons.camera}</span><span>Take a photo</span>
        <input type="file" accept="image/*" capture="environment" data-pick hidden>
      </label>
      <label class="pick__choice">
        <span class="pick__icon">${icons.image}</span><span>Choose from your photos</span>
        <input type="file" accept="image/*" data-pick hidden>
      </label>
    </div>`);
  const sheet = openSheet({ title, body });
  for (const input of body.querySelectorAll('[data-pick]')) {
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';                 // the same photo can be picked again later
      if (!f) return;
      sheet.close();
      onFile(f);
    });
  }
  return sheet;
}

/** Shared busy wrapper: shrink + save can take a second on big photos. */
export async function withPhotoBusy(fn) {
  toast('Saving your photo…', { ms: 8000 });
  try {
    const r = await fn();
    toast('Photo saved');
    return r;
  } catch (e) {
    console.error(e);
    toast('That photo couldn’t be opened. Try another one.');
    return null;
  }
}

/**
 * Full-screen viewer. getUrl() -> Promise<url|null>.
 * actions: { isCover, onCover(), onDelete() }
 */
export function viewPhoto({ getUrl, isCover, onCover, onDelete, noCover = false }) {
  const node = el(`
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div class="viewer__top">
        <button type="button" class="icon-btn icon-btn--round" data-close aria-label="Close">${icons.close}</button>
      </div>
      <div class="viewer__stage"><p class="viewer__wait">Loading the photo…</p><img alt="" hidden></div>
      <div class="viewer__bar">
        <button type="button" class="btn btn--butter" data-cover ${isCover ? 'disabled' : ''} ${noCover ? 'hidden' : ''}>${icons.star}<span>${isCover ? 'This is the cover' : 'Use as cover'}</span></button>
        <button type="button" class="btn btn--danger-soft viewer__del" data-del>${icons.trash}<span>Delete</span></button>
      </div>
    </div>`);
  document.body.appendChild(node);
  const close = () => { node.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-cover]').addEventListener('click', async () => {
    await onCover();
    toast('Cover photo changed');
    close();
  });
  node.querySelector('[data-del]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete this photo?',
      message: 'It will be removed from this project on all your devices.',
      ok: 'Delete photo', danger: true,
    });
    if (!ok) return;
    await onDelete();
    toast('Photo deleted');
    close();
  });
  getUrl().then((u) => {
    if (!node.isConnected) return;
    const img = node.querySelector('img');
    const wait = node.querySelector('.viewer__wait');
    if (!u) { wait.textContent = 'This photo hasn’t arrived on this device yet. Try again when you’re online.'; return; }
    img.src = u;
    img.hidden = false;
    wait.hidden = true;
  });
  return { close };
}
