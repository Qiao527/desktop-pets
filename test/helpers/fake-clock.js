"use strict";

// Deterministic clock for scheduler tests. advance(ms) fires due timers in
// time order and lets promise callbacks settle between them.

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createFakeClock(start = 0) {
  let now = start;
  let nextId = 1;
  const timers = new Map();

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pendingTimers: () => timers.size,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        await flush();
        let dueId = null;
        let due = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!due || t.at < due.at)) { dueId = id; due = t; }
        }
        if (!due) break;
        timers.delete(dueId);
        now = due.at;
        due.fn();
      }
      now = target;
      await flush();
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

module.exports = { createFakeClock, deferred, flush };
