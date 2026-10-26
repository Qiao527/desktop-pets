const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createPoller } = require("../src/activity/poller");
const { ProbeError, ErrorKind } = require("../src/activity/exec");
const { createFakeClock, deferred, flush } = require("./helpers/fake-clock");

function setup(overrides = {}) {
  const clock = createFakeClock(1000);
  const calls = [];
  const changes = [];
  const healthEvents = [];
  const poller = createPoller({
    name: "test",
    intervalMs: 100,
    timeoutMs: 500,
    backoff: { baseMs: 1000, maxMs: 8000, factor: 2, jitter: 0 },
    permissionRetryMs: 60000,
    clock,
    random: () => 0.5,
    onChange: (v, prev) => changes.push([prev, v]),
    onHealthChange: (h) => healthEvents.push(h.status),
    probe: async (ctx) => { calls.push(ctx); return true; },
    ...overrides,
  });
  return { clock, calls, changes, healthEvents, poller };
}

describe("activity poller: scheduling", () => {
  it("runs immediately on start and then every intervalMs", async () => {
    const { clock, calls, poller } = setup();
    poller.start();
    await clock.advance(0);
    assert.strictEqual(calls.length, 1);
    await clock.advance(100);
    assert.strictEqual(calls.length, 2);
    await clock.advance(1000);
    assert.strictEqual(calls.length, 12);
    poller.stop();
  });

  it("deduplicates values: onChange fires only when the reading changes", async () => {
    const readings = [true, true, false, false, true];
    const { clock, changes, poller } = setup({ probe: async () => readings.shift() ?? true });
    poller.start();
    await clock.advance(500);
    assert.deepStrictEqual(changes, [[false, true], [true, false], [false, true]]);
    poller.stop();
  });

  it("never overlaps: a slow probe delays the next run instead of stacking", async () => {
    const gate = deferred();
    let active = 0;
    let maxActive = 0;
    let count = 0;
    const { clock, poller } = setup({
      timeoutMs: 60000,
      probe: async () => {
        count++;
        active++;
        maxActive = Math.max(maxActive, active);
        if (count === 1) await gate.promise;
        active--;
        return true;
      },
    });
    poller.start();
    await clock.advance(5000); // 50 intervals' worth of time while run #1 is stuck
    assert.strictEqual(count, 1);
    assert.strictEqual(poller.getHealth().inFlight, true);
    gate.resolve();
    await clock.advance(0);
    await clock.advance(100);
    assert.strictEqual(count, 2);
    assert.strictEqual(maxActive, 1);
    poller.stop();
  });

  it("uses getIntervalMs for adaptive polling", async () => {
    let observed = true;
    const { clock, calls, poller } = setup({ getIntervalMs: () => (observed ? 100 : 1000) });
    poller.start();
    await clock.advance(0);
    observed = false;
    await clock.advance(100); // the run scheduled while observed fires at 100ms
    const after = calls.length;
    await clock.advance(900);
    assert.strictEqual(calls.length, after, "slow interval should not fire before 1000ms");
    await clock.advance(100);
    assert.strictEqual(calls.length, after + 1);
    poller.stop();
  });
});

describe("activity poller: timeouts and failures", () => {
  it("aborts a hung probe after timeoutMs and reports a timeout", async () => {
    let signal;
    const { clock, poller } = setup({
      probe: ({ signal: s }) => { signal = s; return new Promise(() => {}); },
    });
    poller.start();
    await clock.advance(499);
    assert.strictEqual(signal.aborted, false);
    await clock.advance(1);
    assert.strictEqual(signal.aborted, true);
    const h = poller.getHealth();
    assert.strictEqual(h.totalTimeouts, 1);
    assert.strictEqual(h.lastErrorKind, ErrorKind.TIMEOUT);
    assert.strictEqual(h.status, "degraded");
    assert.strictEqual(h.inFlight, false);
    poller.stop();
  });

  it("backs off exponentially and caps at maxMs", async () => {
    const { clock, poller } = setup({ probe: async () => { throw new ProbeError(ErrorKind.ERROR, "boom"); } });
    poller.start();
    const delays = [];
    await clock.advance(0);
    for (let i = 0; i < 6; i++) {
      delays.push(poller.getHealth().nextDelayMs);
      await clock.advance(poller.getHealth().nextDelayMs);
    }
    assert.deepStrictEqual(delays, [1000, 2000, 4000, 8000, 8000, 8000]);
    poller.stop();
  });

  it("keeps jittered delays within ±jitter of the nominal delay", async () => {
    for (const r of [0, 1]) {
      const { clock, poller } = setup({
        backoff: { baseMs: 1000, maxMs: 8000, factor: 2, jitter: 0.2 },
        random: () => r,
        probe: async () => { throw new Error("plain error"); },
      });
      poller.start();
      await clock.advance(0);
      const d = poller.getHealth().nextDelayMs;
      assert.strictEqual(d, r === 0 ? 800 : 1200, `random=${r}`);
      poller.stop();
    }
  });

  it("waits permissionRetryMs after a permission error and reports it", async () => {
    const { clock, poller, healthEvents } = setup({
      probe: async () => { throw new ProbeError(ErrorKind.PERMISSION, "denied"); },
    });
    poller.start();
    await clock.advance(0);
    const h = poller.getHealth();
    assert.strictEqual(h.status, "permission-denied");
    assert.strictEqual(h.nextDelayMs, 60000);
    assert.ok(healthEvents.includes("permission-denied"));
    poller.stop();
  });

  it("reports the neutral value on failure (legacy parity) and recovers on success", async () => {
    let fail = false;
    const { clock, poller } = setup({
      probe: async () => { if (fail) throw new Error("x"); return true; },
    });
    poller.start();
    await clock.advance(0);
    assert.strictEqual(poller.getValue(), true);
    fail = true;
    await clock.advance(100);
    assert.strictEqual(poller.getValue(), false);
    assert.strictEqual(poller.getHealth().consecutiveFailures, 1);
    fail = false;
    await clock.advance(poller.getHealth().nextDelayMs);
    const h = poller.getHealth();
    assert.strictEqual(poller.getValue(), true);
    assert.strictEqual(h.consecutiveFailures, 0);
    assert.strictEqual(h.status, "ok");
    assert.strictEqual(h.nextDelayMs, 100);
    poller.stop();
  });

  it("treats a synchronous throw in the probe as a failure", async () => {
    const { clock, poller } = setup({ probe: () => { throw new Error("sync"); } });
    poller.start();
    await clock.advance(0);
    assert.strictEqual(poller.getHealth().totalFailures, 1);
    poller.stop();
  });
});

describe("activity poller: lifecycle", () => {
  it("stop() aborts the in-flight run and ignores its late result", async () => {
    const gate = deferred();
    let signal;
    let count = 0;
    const { clock, poller, changes } = setup({
      timeoutMs: 60000,
      probe: ({ signal: s }) => { count++; signal = s; return gate.promise; },
    });
    poller.start();
    await clock.advance(0);
    poller.stop();
    assert.strictEqual(signal.aborted, true);
    gate.resolve(true);
    await clock.advance(10000);
    assert.strictEqual(count, 1);
    assert.strictEqual(poller.getValue(), false);
    assert.deepStrictEqual(changes, []);
    assert.strictEqual(poller.getHealth().status, "stopped");
    assert.strictEqual(clock.pendingTimers(), 0, "no timers may leak after stop");
  });

  it("restart() discards the stale run and starts a fresh one", async () => {
    const first = deferred();
    let count = 0;
    const { clock, poller } = setup({
      timeoutMs: 60000,
      probe: () => { count++; return count === 1 ? first.promise : Promise.resolve(true); },
    });
    poller.start();
    await clock.advance(0);
    poller.restart();
    await clock.advance(0);
    assert.strictEqual(count, 2);
    assert.strictEqual(poller.getValue(), true);
    first.resolve(false); // stale result must not overwrite the fresh reading
    await clock.advance(0);
    assert.strictEqual(poller.getValue(), true);
    poller.stop();
  });

  it("refresh() runs immediately when idle and coalesces while in flight", async () => {
    const gate = deferred();
    let count = 0;
    const { clock, poller } = setup({
      intervalMs: 10000,
      timeoutMs: 60000,
      probe: () => { count++; return count === 2 ? gate.promise : Promise.resolve(true); },
    });
    poller.start();
    await clock.advance(0);
    assert.strictEqual(count, 1);
    poller.refresh();
    await clock.advance(0);
    assert.strictEqual(count, 2); // immediate, did not wait 10s
    poller.refresh();
    poller.refresh();
    await clock.advance(0);
    assert.strictEqual(count, 2, "refresh during a run must not overlap");
    gate.resolve(true);
    await clock.advance(0);
    assert.strictEqual(count, 3, "queued refreshes collapse into one run");
    poller.stop();
  });

  it("start() and stop() are idempotent", async () => {
    const { clock, calls, poller } = setup();
    poller.start();
    poller.start();
    await clock.advance(0);
    assert.strictEqual(calls.length, 1);
    poller.stop();
    poller.stop();
    assert.strictEqual(poller.isRunning(), false);
  });

  it("tracks latency percentiles over recent runs", async () => {
    let n = 0;
    const clock = createFakeClock(0);
    const poller = createPoller({
      name: "lat",
      intervalMs: 100,
      timeoutMs: 5000,
      clock,
      probe: () => new Promise((resolve) => clock.setTimeout(() => resolve(true), (++n) * 10)),
    });
    poller.start();
    for (let i = 0; i < 10; i++) await clock.advance(1000);
    const { latencyMs } = poller.getHealth();
    assert.ok(latencyMs.samples >= 5);
    assert.ok(latencyMs.p95 >= latencyMs.p50);
    poller.stop();
    await flush();
  });

  it("rejects invalid configuration", () => {
    assert.throws(() => createPoller({ name: "x", timeoutMs: 10 }), /probe/);
    assert.throws(() => createPoller({ name: "x", probe: () => 1, timeoutMs: 0 }), /timeoutMs/);
  });
});
