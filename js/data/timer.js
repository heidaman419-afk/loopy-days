// Knitting sessions and the timer.
// Everything is worked out from saved timestamps, never from a ticking interval,
// so the time stays right when iOS freezes the page in the background.

import * as db from '../db.js';

export const LONG_PAUSE_MS = 4 * 60 * 60 * 1000; // 4 hours

export const TIMER_DEFAULTS = {
  mode: 'auto_pause',     // 'keep' | 'pause_on_leave' | 'auto_pause'
  idle_min: 30,           // auto-pause after this many minutes without taps
  breaks: false,          // break reminders on/off
  break_every: 60,        // minutes of active time between reminders
  break_len: 5,           // minutes
};

export async function loadTimerSettings() {
  return { ...TIMER_DEFAULTS, ...(await db.getSetting('timer', {})) };
}

export function saveTimerSettings(s) {
  return db.setSetting('timer', { ...s });
}

/**
 * One session as it stands right now, applying the auto-pause and 4-hour rules even
 * when no counter screen is open to apply them. -> { ms, state: 'running'|'paused'|'ended' }
 */
export function sessionNow(s, settings = TIMER_DEFAULTS, now = Date.now()) {
  if (!s) return { ms: 0, state: 'ended' };
  if (s.status === 'ended') return { ms: s.active_ms || 0, state: 'ended' };
  if (s.status !== 'running') return { ms: s.active_ms || 0, state: 'paused' };
  let end = now;
  let state = 'running';
  const quiet = now - (s.last_activity || s.seg_start);
  const idle = (settings.idle_min || 30) * 60000;
  if (quiet >= LONG_PAUSE_MS) { end = s.last_activity; state = 'paused'; }
  else if (settings.mode === 'auto_pause' && quiet >= idle) { end = s.last_activity + idle; state = 'paused'; }
  return { ms: (s.active_ms || 0) + Math.max(0, end - s.seg_start), state };
}

/** Total time worked on a project (all its sessions, the open one counted live). */
export async function timeWorked(projectId, settings, now = Date.now()) {
  const sessions = await db.byIndex('sessions', 'project_id', projectId);
  return sessions.reduce((t, s) => t + sessionNow(s, settings, now).ms, 0);
}

function newSession(projectId, now) {
  return {
    id: db.newId(),
    project_id: projectId,
    started_at: new Date(now).toISOString(),
    ended_at: null,
    active_ms: 0,          // time spent running, finished segments only
    paused_ms: 0,
    rows: 0,               // net rows added on the main counter
    status: 'running',     // 'running' | 'paused' | 'ended'
    seg_start: now,        // epoch ms the current running stretch began
    paused_at: null,       // epoch ms when paused
    last_activity: now,    // epoch ms of the last tap / start / resume
    pause_reason: null,    // 'user' | 'left' | 'idle' | 'long'
    break_base_ms: 0,      // active ms when the last break reminder was handled
    end_reason: null,      // 'user' | 'long-pause' | 'deleted'
  };
}

export class SessionTimer {
  static async load(projectId, settings) {
    const rows = await db.byIndex('sessions', 'project_id', projectId);
    const open = rows.filter((s) => s.status !== 'ended')
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    const t = new SessionTimer(projectId, settings, open[0] || null);
    // Older open sessions can exist (e.g. one from another device after a sync).
    // Only tidy up ones that have been quiet for 4 h+, so a live session elsewhere is left alone.
    const now = Date.now();
    t.strays = open.slice(1).filter((s) => now - (s.paused_at || s.last_activity || 0) >= LONG_PAUSE_MS);
    return t;
  }

  constructor(projectId, settings, session) {
    this.projectId = projectId;
    this.settings = settings;
    this.s = session;
  }

  get running() { return !!this.s && this.s.status === 'running'; }
  get paused() { return !!this.s && this.s.status === 'paused'; }

  activeMs(now = Date.now()) {
    if (!this.s) return 0;
    return this.s.active_ms + (this.s.status === 'running' ? Math.max(0, now - this.s.seg_start) : 0);
  }

  start(now = Date.now()) {
    this.s = newSession(this.projectId, now);
    return this.s;
  }

  pause(at = Date.now(), reason = 'user') {
    const s = this.s;
    if (!s || s.status !== 'running') return null;
    at = Math.max(at, s.seg_start);
    s.active_ms += at - s.seg_start;
    s.status = 'paused';
    s.paused_at = at;
    s.pause_reason = reason;
    return s;
  }

  resume(now = Date.now()) {
    const s = this.s;
    if (!s || s.status !== 'paused') return null;
    s.paused_ms += Math.max(0, now - s.paused_at);
    s.status = 'running';
    s.seg_start = now;
    s.paused_at = null;
    s.pause_reason = null;
    s.last_activity = now;
    return s;
  }

  /** End the session. If it was paused, it ends at the moment it was paused. */
  end(reason = 'user', now = Date.now()) {
    const s = this.s;
    if (!s) return null;
    if (s.status === 'running') this.pause(now, reason);
    s.ended_at = new Date(s.paused_at || now).toISOString();
    s.status = 'ended';
    s.end_reason = reason;
    this.s = null;
    return s;
  }

  /** Start / pause / resume from the timer pill. Returns the record to save. */
  toggle(now = Date.now()) {
    if (!this.s) return this.start(now);
    if (this.running) return this.pause(now, 'user');
    return this.resume(now);
  }

  /** A tap on the main counter. +rows start or resume a session. */
  noteTap(applied, now = Date.now()) {
    if (applied > 0) {
      if (!this.s) this.start(now);
      else if (this.paused) this.resume(now);
    }
    if (!this.s) return null;
    this.s.rows += applied;
    if (this.running) this.s.last_activity = now;
    return this.s;
  }

  /** Undo on the main counter while a session is open. */
  noteUndo(mainDelta) {
    if (!this.s || !mainDelta) return null;
    this.s.rows += mainDelta;
    return this.s;
  }

  /** Auto-pause after inactivity (when that mode is on). Returns the record if it changed. */
  checkIdle(now = Date.now()) {
    if (!this.running || this.settings.mode !== 'auto_pause') return null;
    const limit = this.settings.idle_min * 60000;
    if (now - this.s.last_activity >= limit) return this.pause(this.s.last_activity + limit, 'idle');
    return null;
  }

  /**
   * On opening: has this session been sitting untouched for 4 h or more?
   * A running one is paused back at its last activity so the idle hours don't count.
   */
  checkLongPause(now = Date.now()) {
    if (!this.s) return false;
    if (this.running && now - this.s.last_activity >= LONG_PAUSE_MS) {
      this.pause(this.s.last_activity, 'long');
      return true;
    }
    return this.paused && now - this.s.paused_at >= LONG_PAUSE_MS;
  }

  /** The page was hidden or the counter screen closed. */
  onLeave(now = Date.now()) {
    if (this.running && this.settings.mode === 'pause_on_leave') return this.pause(now, 'left');
    return null;
  }

  /** Is a break reminder due? */
  breakDue(now = Date.now()) {
    if (!this.running || !this.settings.breaks) return false;
    return this.activeMs(now) - (this.s.break_base_ms || 0) >= this.settings.break_every * 60000;
  }

  breakHandled(now = Date.now()) {
    if (!this.s) return null;
    this.s.break_base_ms = this.activeMs(now);
    return this.s;
  }
}
