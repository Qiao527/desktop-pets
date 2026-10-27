"use strict";

// Activity time accounting.
//
// The tracker turns a stream of category observations into per-day,
// per-hour durations. It records only coarse categories and timestamps —
// never app names, window titles, text, or document contents.
//
// Accounting rules:
//  - Exactly one category is active at a time (see categorize()).
//  - A segment is credited when the category changes, on pause
//    (suspend / lock / quit / tracking disabled), or on flush().
//  - Segments are split at local midnight and at hour boundaries using
//    local-time Date arithmetic, so DST days have 23 or 25 hours.
//  - If no observation arrives for longer than maxGapMs (e.g. the process
//    was frozen during sleep without a suspend event), only time up to the
//    last observation is credited; the gap is dropped.
//  - If the wall clock moves backwards, the open segment is discarded.

const CATEGORIES = Object.freeze(["typing", "listening", "agent", "idle", "sleeping"]);

// No keyboard or mouse input for this long counts as "away" (stored as the
// "sleeping" category). Matches the default theme's pet sleep timeout.
const AWAY_AFTER_MS = 120000;
const AGENT_BUSY_STATES = new Set(["thinking", "working", "juggling", "sweeping", "carrying"]);

/**
 * Decide the single category for "right now". Returns null when time should
 * not be recorded at all (system asleep or screen locked).
 *
 * `userIdleMs` is the OS keyboard+mouse idle time (powerMonitor), which —
 * unlike the pet's mouse-only sleep timer — resets while the user types.
 */
function categorize({ systemPaused = false, doNotDisturb = false, userIdleMs = 0, textFocused = false, mediaPlaying = false, agentBusy = false }) {
  if (systemPaused) return null;
  if (doNotDisturb) return "sleeping";
  const away = userIdleMs >= AWAY_AFTER_MS;
  if (textFocused && !away) return "typing";
  if (mediaPlaying) return "listening";
  if (agentBusy) return "agent";
  if (away) return "sleeping";
  return "idle";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Start of the next local hour after `ms`. Computed from the minutes/seconds
 * already elapsed in the current local hour, so the repeated hour on a DST
 * fall-back day is a separate (60 minute) bucket rather than being skipped.
 */
function nextLocalHour(ms) {
  const d = new Date(ms);
  return ms + 3600000 - (d.getMinutes() * 60000 + d.getSeconds() * 1000 + d.getMilliseconds());
}

function emptyDay() {
  const day = { totalsMs: {}, hourlyMs: {} };
  for (const c of CATEGORIES) {
    day.totalsMs[c] = 0;
    day.hourlyMs[c] = new Array(24).fill(0);
  }
  return day;
}

/**
 * Add [startMs, endMs) of `category` into `days`, split by local hour/day.
 * Mutates and returns `days`.
 */
function creditInterval(days, category, startMs, endMs) {
  let t = startMs;
  while (t < endMs) {
    const boundary = Math.min(endMs, nextLocalHour(t));
    const key = localDayKey(t);
    const hour = new Date(t).getHours();
    const day = days[key] || (days[key] = emptyDay());
    const ms = boundary - t;
    day.totalsMs[category] += ms;
    day.hourlyMs[category][hour] += ms;
    t = boundary;
  }
  return days;
}

function createTracker({ now = () => Date.now(), maxGapMs = 120000, onCredit = null } = {}) {
  let current = null; // { category, since }
  let lastSeen = null;
  let days = {};

  function credit(category, start, end) {
    if (end <= start) return;
    creditInterval(days, category, start, end);
    if (onCredit) onCredit(category, start, end);
  }

  function closeAt(end) {
    if (current) credit(current.category, current.since, end);
    current = null;
  }

  /**
   * Record that `category` is active at the current time. Repeated
   * observations of the same category are no-ops (duplicate suppression).
   */
  function observe(category) {
    const t = now();
    if (category !== null && !CATEGORIES.includes(category)) throw new RangeError(`unknown category ${category}`);

    if (lastSeen !== null && t < lastSeen) {
      // Clock went backwards: we cannot know what happened; drop the segment.
      current = null;
    } else if (current && lastSeen !== null && t - lastSeen > maxGapMs) {
      closeAt(lastSeen);
    }
    lastSeen = t;

    if (category === null) { closeAt(t); return; }
    if (current && current.category === category) return;
    closeAt(t);
    current = { category, since: t };
  }

  /** Stop accounting (suspend, lock, quit, tracking disabled). */
  function pause() {
    const t = now();
    if (lastSeen !== null && t < lastSeen) current = null;
    else if (current && lastSeen !== null && t - lastSeen > maxGapMs) closeAt(lastSeen);
    closeAt(t);
    lastSeen = null;
  }

  /**
   * Credit the open segment up to now without ending it, and hand back the
   * accumulated per-day deltas (then reset them). Used for periodic saves.
   */
  function drain() {
    const t = now();
    if (current) {
      if (lastSeen !== null && t - lastSeen > maxGapMs) {
        closeAt(lastSeen);
      } else if (t >= current.since) {
        credit(current.category, current.since, t);
        current = { category: current.category, since: t };
      }
    }
    const out = days;
    days = {};
    return out;
  }

  return {
    observe,
    pause,
    drain,
    getCurrent: () => (current ? { ...current } : null),
  };
}

/** Merge per-day deltas into a stored `days` object (mutates target). */
function mergeDays(target, delta) {
  for (const [key, d] of Object.entries(delta)) {
    const day = target[key] || (target[key] = emptyDay());
    for (const c of CATEGORIES) {
      day.totalsMs[c] = (day.totalsMs[c] || 0) + (d.totalsMs[c] || 0);
      if (!Array.isArray(day.hourlyMs[c])) day.hourlyMs[c] = new Array(24).fill(0);
      for (let h = 0; h < 24; h++) day.hourlyMs[c][h] += (d.hourlyMs[c] && d.hourlyMs[c][h]) || 0;
    }
  }
  return target;
}

module.exports = {
  CATEGORIES,
  AWAY_AFTER_MS,
  AGENT_BUSY_STATES,
  categorize,
  localDayKey,
  creditInterval,
  emptyDay,
  mergeDays,
  createTracker,
};
