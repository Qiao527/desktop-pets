"use strict";

// Opt-in activity recorder. Nothing is sampled, kept in memory, or written
// to disk until enable() is called; disable() stops sampling and flushes
// what was already measured. deleteAll() erases every stored file.

const { categorize, createTracker, mergeDays, AGENT_BUSY_STATES } = require("./tracker");
const { summarizeHistory } = require("./summary");

const POWER_EVENTS = ["suspend", "resume", "lock-screen", "unlock-screen"];

function createActivityRecorder({
  store,
  engine,
  getPetState = () => null,
  getDoNotDisturb = () => false,
  getSessions = () => null,
  powerMonitor = null,
  now = () => Date.now(),
  sampleMs = 5000,
  flushMs = 60000,
  timers = { setInterval, clearInterval },
}) {
  let enabled = false;
  let tracker = null;
  let sampleTimer = null;
  let flushTimer = null;
  let unsubscribe = null;
  let systemPaused = false;
  let loadError = null;
  const powerHandlers = [];

  function agentBusy() {
    const sessions = getSessions();
    if (!sessions || typeof sessions.values !== "function") return false;
    for (const s of sessions.values()) if (s && AGENT_BUSY_STATES.has(s.state)) return true;
    return false;
  }

  function currentCategory() {
    const snap = engine ? engine.getSnapshot() : {};
    return categorize({
      systemPaused: systemPaused || (engine ? engine.isPaused() : false),
      petState: getPetState(),
      doNotDisturb: getDoNotDisturb(),
      textFocused: !!snap.textFocused,
      mediaPlaying: !!snap.mediaPlaying,
      agentBusy: agentBusy(),
    });
  }

  function sample() {
    if (!enabled || !tracker) return;
    tracker.observe(currentCategory());
  }

  function mergePending() {
    if (!tracker) return;
    const delta = tracker.drain();
    store.update((doc) => mergeDays(doc.days, delta));
  }

  async function flush() {
    mergePending();
    try { await store.save(); } catch (err) { console.warn("activity: save failed:", err.message); }
  }

  function onPower(event) {
    if (!enabled || !tracker) return;
    if (event === "suspend" || event === "lock-screen") {
      systemPaused = true;
      tracker.pause();
      flush();
    } else {
      systemPaused = false;
      sample();
    }
  }

  async function enable() {
    if (enabled) return;
    enabled = true;
    try {
      await store.load();
      loadError = null;
    } catch (err) {
      loadError = err.message;
      enabled = false;
      throw err;
    }
    if (!enabled) return; // disabled while loading
    tracker = createTracker({ now });
    systemPaused = false;
    sample();
    sampleTimer = timers.setInterval(sample, sampleMs);
    flushTimer = timers.setInterval(flush, flushMs);
    if (engine) unsubscribe = engine.onChange(sample);
    if (powerMonitor && typeof powerMonitor.on === "function") {
      for (const e of POWER_EVENTS) {
        const fn = () => onPower(e);
        powerMonitor.on(e, fn);
        powerHandlers.push([e, fn]);
      }
    }
  }

  function stopSampling() {
    if (sampleTimer) { timers.clearInterval(sampleTimer); sampleTimer = null; }
    if (flushTimer) { timers.clearInterval(flushTimer); flushTimer = null; }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (powerMonitor) for (const [e, fn] of powerHandlers) powerMonitor.removeListener(e, fn);
    powerHandlers.length = 0;
  }

  async function disable() {
    if (!enabled) return;
    enabled = false;
    stopSampling();
    if (tracker) {
      tracker.pause();
      await flush();
      tracker = null;
    }
  }

  async function deleteAll() {
    if (tracker) { tracker.pause(); tracker.drain(); }
    await store.deleteAll();
    if (enabled) tracker = createTracker({ now });
  }

  /** Summary for the Insights window; null when no history exists. */
  async function getSummary(span = 7) {
    if (!store.getDoc()) {
      if (!(await store.hasData())) return null;
      await store.load();
    }
    if (enabled) mergePending();
    return summarizeHistory(store.getDoc().days, now(), span);
  }

  return {
    enable,
    disable,
    flush,
    deleteAll,
    getSummary,
    sample,
    isEnabled: () => enabled,
    getCurrentCategory: () => (tracker && tracker.getCurrent() ? tracker.getCurrent().category : null),
    getStatus: () => ({
      enabled,
      file: store.file,
      readOnly: store.isReadOnly(),
      loadInfo: store.getDoc() ? store.getLoadInfo() : null,
      loadError,
    }),
  };
}

module.exports = { createActivityRecorder };
