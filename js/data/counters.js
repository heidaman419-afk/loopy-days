// Counter model for one project: the main counter, extra counters, row notes
// and the undo history. All changes happen in memory first (so the screen can
// update instantly) and hand back the records to save.

import * as db from '../db.js';

const HISTORY_GROUPS = 50;   // how many actions Undo can walk back
const HISTORY_EVENTS = 300;  // events read on open to rebuild that history

export function newCounter(projectId, fields = {}) {
  return {
    id: db.newId(),
    project_id: projectId,
    name: 'Rows',
    value: 0,
    target: null,            // goal, or null
    is_main: false,
    step: 1,                 // small step (+1 / -1)
    big_step: 5,             // big step (+5)
    reset_with_main: false,  // extra counters: go back to 0 when the main count goes up
    sort: 0,
    last_tapped_at: null,
    goal_reached_at: null,
    ...fields,
  };
}

export class ProjectCounters {
  static async load(projectId) {
    const all = await db.byIndex('counters', 'project_id', projectId);
    let main = all.find((c) => c.is_main);
    if (!main) {
      main = newCounter(projectId, { is_main: true, name: 'Rows' });
      await db.put('counters', main);
    }
    const extras = all.filter((c) => !c.is_main).sort((a, b) => a.sort - b.sort);
    const notes = (await db.byIndex('row_notes', 'counter_id', main.id)).sort((a, b) => a.row - b.row);

    const range = IDBKeyRange.bound([projectId, ''], [projectId, '￿']);
    const events = await db.latest('counter_events', 'project_at', range, HISTORY_EVENTS);
    const model = new ProjectCounters(projectId, main, extras, notes);
    model.rebuildHistory(events.reverse());
    return model;
  }

  constructor(projectId, main, extras, notes) {
    this.projectId = projectId;
    this.main = main;
    this.extras = extras;
    this.notes = notes;
    this.history = []; // [{ group_id, events: [...] }], oldest first
  }

  rebuildHistory(eventsOldestFirst) {
    const known = new Set([this.main.id, ...this.extras.map((c) => c.id)]);
    const groups = new Map();
    for (const ev of eventsOldestFirst) {
      if (!known.has(ev.counter_id)) continue;
      const g = groups.get(ev.group_id) || { group_id: ev.group_id, events: [] };
      g.events.push(ev);
      groups.set(ev.group_id, g);
    }
    this.history = [...groups.values()].slice(-HISTORY_GROUPS);
  }

  counterById(id) {
    return id === this.main.id ? this.main : this.extras.find((c) => c.id === id);
  }

  get canUndo() { return this.history.length > 0; }

  /**
   * Change a counter by delta (never below 0). Returns null when nothing changed,
   * otherwise { before, after, applied, entries } where entries go to db.putMany.
   */
  bump(counter, delta, kind = 'tap') {
    const before = counter.value;
    const after = Math.max(0, before + delta);
    const applied = after - before;
    if (!applied) return null;

    const at = db.nowISO();
    const changes = [{ c: counter, d: applied, v: after }];
    if (counter.is_main && applied > 0) {
      for (const x of this.extras) {
        if (x.reset_with_main && x.value !== 0) changes.push({ c: x, d: -x.value, v: 0 });
      }
    }
    counter.last_tapped_at = at;
    return this.commit(changes, kind, at, { before, after, applied });
  }

  /** Set a counter straight to 0 (as one undoable step). */
  reset(counter) {
    if (counter.value === 0) return null;
    const at = db.nowISO();
    return this.commit([{ c: counter, d: -counter.value, v: 0 }], 'reset', at,
      { before: counter.value, after: 0, applied: -counter.value });
  }

  commit(changes, kind, at, result) {
    const group_id = db.newId();
    const events = changes.map(({ c, d, v }) => {
      c.value = v;
      return {
        id: db.newId(),
        project_id: this.projectId,
        counter_id: c.id,
        delta: d,
        value_after: v,
        kind,                 // 'tap' | 'reset' | 'auto-reset'
        group_id,
        at,
      };
    });
    if (events.length > 1) for (let i = 1; i < events.length; i++) events[i].kind = 'auto-reset';
    this.history.push({ group_id, events });
    if (this.history.length > HISTORY_GROUPS) this.history.shift();
    const entries = [
      ...changes.map(({ c }) => ['counters', c]),
      ...events.map((e) => ['counter_events', e]),
    ];
    return { ...result, entries, events };
  }

  /** Walk back the most recent action. Returns { mainDelta, entries } or null. */
  undo() {
    while (this.history.length) {
      const g = this.history.pop();
      const entries = [];
      let mainDelta = 0;
      for (const ev of [...g.events].reverse()) {
        const c = this.counterById(ev.counter_id);
        if (!c) continue;
        c.value = Math.max(0, ev.value_after - ev.delta);
        if (c === this.main && ev.kind === 'tap') mainDelta -= ev.delta;
        ev.deleted = true;   // undone actions drop out of history and stats
        ev.undone = true;
        entries.push(['counters', c], ['counter_events', ev]);
      }
      if (entries.length) return { mainDelta, entries, at: g.events[0].at };
    }
    return null;
  }

  /* ----- extra counters ----- */

  addExtra(name, resetWithMain) {
    const c = newCounter(this.projectId, {
      name, reset_with_main: !!resetWithMain,
      sort: this.extras.length ? Math.max(...this.extras.map((x) => x.sort)) + 1 : 1,
    });
    this.extras.push(c);
    return c;
  }

  removeExtra(c) {
    this.extras = this.extras.filter((x) => x !== c);
    c.deleted = true;
    for (const g of this.history) g.events = g.events.filter((e) => e.counter_id !== c.id);
    this.history = this.history.filter((g) => g.events.length);
  }

  /* ----- row notes ----- */

  addNote(row, text) {
    const n = { id: db.newId(), counter_id: this.main.id, project_id: this.projectId, row, text, done: false };
    this.notes.push(n);
    this.notes.sort((a, b) => a.row - b.row);
    return n;
  }

  removeNote(n) {
    this.notes = this.notes.filter((x) => x !== n);
    n.deleted = true;
  }

  /** Notes whose row was reached by going from `before` up to `after`. */
  notesReached(before, after) {
    if (after <= before) return [];
    return this.notes.filter((n) => !n.done && n.row > before && n.row <= after);
  }

  nextNote() {
    return this.notes.find((n) => !n.done && n.row > this.main.value) || null;
  }

  /** Soft delete the whole counter set of this project (main, extras, notes). */
  deleteAllEntries() {
    const entries = [];
    for (const c of [this.main, ...this.extras]) { c.deleted = true; entries.push(['counters', c]); }
    for (const n of this.notes) { n.deleted = true; entries.push(['row_notes', n]); }
    return entries;
  }
}
