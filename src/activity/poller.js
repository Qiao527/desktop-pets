"use strict";

// Generic non-blocking poller for activity detectors.
//
// Guarantees:
//  - Never overlaps: the next run is scheduled only after the previous one
//    settles (chained setTimeout, not setInterval).
//  - Every run is bounded by `timeoutMs`; a hung probe is aborted.
//  - Failures back off exponentially (with jitter); permission failures wait
//    `permissionRetryMs` because they only change when the user acts.
//  - stop()/restart() invalidate in-flight runs via a generation counter, so
//    a late result can never resurrect a stopped poller or emit stale values.
//  - Values are deduplicated: onChange fires only when the value changes.

const { ErrorKind, ProbeError } = require("./exec");

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

const LATENCY_WINDOW = 50;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function createPoller({
  name,
  probe,
  intervalMs,
  getIntervalMs = null,
  timeoutMs,
  backoff = {},
  permissionRetryMs = 60000,
  initialValue = false,
  equals = Object.is,
  onChange = null,
  onHealthChange = null,
  clock = realClock,
  random = Math.random,
}) {
  if (typeof probe !== "function") throw new TypeError("probe must be a function");
  if (!(timeoutMs > 0)) throw new TypeError("timeoutMs must be > 0");
  const { baseMs = 1000, maxMs = 30000, factor = 2, jitter = 0.2 } = backoff;

  let started = false;
  let generation = 0;
  let timer = null;
  let controller = null;
  let refreshQueued = false;
  let value = initialValue;
  const latencies = [];

  const health = {
    name,
    status: "stopped",
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorKind: null,
    lastErrorMessage: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    totalFailures: 0,
    totalTimeouts: 0,
    nextDelayMs: null,
  };

  function setStatus(status) {
    if (health.status === status) return;
    health.status = status;
    if (onHealthChange) onHealthChange(getHealth());
  }

  function setValue(next) {
    if (equals(value, next)) return;
    const prev = value;
    value = next;
    if (onChange) onChange(next, prev);
  }

  function successDelay() {
    const ms = getIntervalMs ? getIntervalMs() : intervalMs;
    return Math.max(0, ms);
  }

  function failureDelay(kind, failures) {
    if (kind === ErrorKind.PERMISSION) return permissionRetryMs;
    const raw = Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, failures - 1)));
    const spread = raw * jitter * (2 * random() - 1);
    return Math.max(0, Math.round(Math.min(maxMs, raw + spread)));
  }

  function schedule(delayMs) {
    if (timer) clock.clearTimeout(timer);
    health.nextDelayMs = delayMs;
    const gen = generation;
    timer = clock.setTimeout(() => {
      timer = null;
      runOnce(gen);
    }, delayMs);
  }

  async function runOnce(gen) {
    if (!started || gen !== generation) return;
    const ac = new AbortController();
    controller = ac;
    const startedAt = clock.now();
    let guard = null;

    let outcome;
    try {
      const work = Promise.resolve().then(() => probe({ signal: ac.signal, timeoutMs }));
      work.catch(() => {}); // the guard may win the race; never leave a rejection unhandled
      const deadline = new Promise((_, reject) => {
        guard = clock.setTimeout(() => {
          ac.abort();
          reject(new ProbeError(ErrorKind.TIMEOUT, `${name} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      outcome = { ok: true, value: await Promise.race([work, deadline]) };
    } catch (err) {
      outcome = { ok: false, err };
    } finally {
      if (guard) clock.clearTimeout(guard);
    }

    // stop() or restart() happened while this run was in flight: drop it.
    if (!started || gen !== generation) return;
    controller = null;

    const elapsed = clock.now() - startedAt;
    latencies.push(elapsed);
    if (latencies.length > LATENCY_WINDOW) latencies.shift();
    health.totalRuns++;

    let delay;
    if (outcome.ok) {
      health.lastSuccessAt = clock.now();
      health.consecutiveFailures = 0;
      setValue(outcome.value);
      setStatus("ok");
      delay = successDelay();
    } else {
      const kind = (outcome.err && outcome.err.kind) || ErrorKind.ERROR;
      health.lastFailureAt = clock.now();
      health.lastErrorKind = kind;
      health.lastErrorMessage = (outcome.err && outcome.err.message) || String(outcome.err);
      health.consecutiveFailures++;
      health.totalFailures++;
      if (kind === ErrorKind.TIMEOUT) health.totalTimeouts++;
      // An unknown reading is reported as the neutral initial value
      // (e.g. "not typing"), matching the previous synchronous behavior.
      setValue(initialValue);
      setStatus(kind === ErrorKind.PERMISSION ? "permission-denied" : "degraded");
      delay = failureDelay(kind, health.consecutiveFailures);
    }

    if (refreshQueued) {
      refreshQueued = false;
      delay = 0;
    }
    schedule(delay);
  }

  function start() {
    if (started) return;
    started = true;
    generation++;
    setStatus("starting");
    schedule(0);
  }

  function stop() {
    if (!started) return;
    started = false;
    generation++;
    refreshQueued = false;
    if (timer) { clock.clearTimeout(timer); timer = null; }
    if (controller) { controller.abort(); controller = null; }
    health.nextDelayMs = null;
    setValue(initialValue);
    setStatus("stopped");
  }

  /** Run as soon as possible (e.g. after wake). Coalesces with an in-flight run. */
  function refresh() {
    if (!started) return;
    if (controller) { refreshQueued = true; return; }
    schedule(0);
  }

  function getHealth() {
    const sorted = latencies.slice().sort((a, b) => a - b);
    return {
      ...health,
      value,
      inFlight: !!controller,
      latencyMs: {
        last: latencies.length ? latencies[latencies.length - 1] : null,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        samples: sorted.length,
      },
    };
  }

  return {
    name,
    start,
    stop,
    restart() { stop(); start(); },
    refresh,
    getValue: () => value,
    getHealth,
    isRunning: () => started,
  };
}

module.exports = { createPoller, realClock };
