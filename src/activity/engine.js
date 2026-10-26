"use strict";

// Activity engine: owns the detector pollers, pauses them across system
// sleep / screen lock, and exposes a cached snapshot that the 50ms tick loop
// reads synchronously. Only the snapshot crosses into animation code, so a
// slow AppleScript can never stall eye tracking or the state machine.

const { createPoller, realClock } = require("./poller");
const { textFocusDetector, mediaDetector } = require("./detectors");

const PAUSE_EVENTS = { suspend: "suspended", "lock-screen": "locked" };
const RESUME_EVENTS = { resume: "suspended", "unlock-screen": "locked" };

const EMPTY_SNAPSHOT = Object.freeze({ textFocused: false, mediaPlaying: false });

function createActivityEngine({
  platform = process.platform,
  powerMonitor = null,
  isObserved = () => true,
  detectors = null,
  clock = realClock,
  random = Math.random,
  onHealthChange = null,
} = {}) {
  const supported = platform === "darwin";
  let snapshot = { ...EMPTY_SNAPSHOT };
  const listeners = new Set();
  const pauseReasons = new Set();
  let started = false;
  const powerHandlers = [];

  const defs = detectors || { textFocused: textFocusDetector(), mediaPlaying: mediaDetector() };
  const pollers = {};
  if (supported) {
    for (const [key, def] of Object.entries(defs)) {
      pollers[key] = createPoller({
        name: def.name,
        probe: def.probe,
        timeoutMs: def.timeoutMs,
        backoff: def.backoff,
        permissionRetryMs: def.permissionRetryMs,
        // Adaptive polling: back off when nothing is consuming the reading
        getIntervalMs: () => (isObserved() ? def.intervalMs : (def.idleIntervalMs || def.intervalMs)),
        initialValue: false,
        clock,
        random,
        onChange: (value) => update(key, value),
        onHealthChange,
      });
    }
  }

  function update(key, value) {
    if (snapshot[key] === value) return;
    snapshot = { ...snapshot, [key]: value };
    const snap = snapshot;
    for (const fn of listeners) {
      try { fn(snap); } catch (err) { console.warn("activity listener failed:", err.message); }
    }
  }

  function runPollers() {
    for (const p of Object.values(pollers)) p.start();
  }

  function haltPollers() {
    for (const p of Object.values(pollers)) p.stop();
  }

  function onPause(reason) {
    pauseReasons.add(reason);
    haltPollers();
  }

  function onResume(reason) {
    pauseReasons.delete(reason);
    if (started && pauseReasons.size === 0) runPollers();
  }

  function attachPower() {
    if (!powerMonitor || typeof powerMonitor.on !== "function") return;
    for (const [event, reason] of Object.entries(PAUSE_EVENTS)) {
      const fn = () => onPause(reason);
      powerMonitor.on(event, fn);
      powerHandlers.push([event, fn]);
    }
    for (const [event, reason] of Object.entries(RESUME_EVENTS)) {
      const fn = () => onResume(reason);
      powerMonitor.on(event, fn);
      powerHandlers.push([event, fn]);
    }
  }

  function detachPower() {
    if (!powerMonitor) return;
    for (const [event, fn] of powerHandlers) powerMonitor.removeListener(event, fn);
    powerHandlers.length = 0;
  }

  return {
    supported,
    start() {
      if (started || !supported) return;
      started = true;
      attachPower();
      if (pauseReasons.size === 0) runPollers();
    },
    stop() {
      if (!started) return;
      started = false;
      detachPower();
      pauseReasons.clear();
      haltPollers();
    },
    /** Poll immediately, e.g. when the pet becomes observable again. */
    refresh() {
      for (const p of Object.values(pollers)) p.refresh();
    },
    getSnapshot: () => snapshot,
    isPaused: () => pauseReasons.size > 0,
    getPauseReasons: () => [...pauseReasons],
    getHealth() {
      if (!supported) return [];
      return Object.values(pollers).map((p) => p.getHealth());
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createActivityEngine, EMPTY_SNAPSHOT };
