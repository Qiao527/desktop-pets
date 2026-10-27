const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { createActivityRecorder } = require("../src/activity/recorder");
const { createStore } = require("../src/activity/store");
const { summarizeHistory } = require("../src/activity/summary");
const { emptyDay } = require("../src/activity/tracker");

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function fakeEngine(snapshot = { textFocused: false, mediaPlaying: false }) {
  const listeners = new Set();
  return {
    snapshot,
    paused: false,
    getSnapshot() { return this.snapshot; },
    isPaused() { return this.paused; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { for (const fn of listeners) fn(this.snapshot); },
    listenerCount: () => listeners.size,
  };
}

const manualTimers = () => {
  const intervals = new Set();
  return {
    setInterval: (fn) => { const h = { fn }; intervals.add(h); return h; },
    clearInterval: (h) => intervals.delete(h),
    count: () => intervals.size,
  };
};

function setup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-rec-"));
  let t = at(2026, 10, 26, 9);
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const engine = fakeEngine();
  const power = new EventEmitter();
  const timers = manualTimers();
  let idleMs = 0;
  const recorder = createActivityRecorder({
    store: createStore({ dir, now: clock.now }),
    engine,
    powerMonitor: power,
    getUserIdleMs: () => idleMs,
    now: clock.now,
    timers,
    ...overrides,
  });
  return { dir, clock, engine, power, timers, recorder, setIdle: (ms) => { idleMs = ms; } };
}

describe("activity recorder: opt-in", () => {
  it("writes nothing and creates no directory until enabled", async () => {
    const { dir, recorder } = setup();
    const activityDir = path.join(dir, "activity");
    const rec = createActivityRecorder({ store: createStore({ dir: activityDir }), engine: fakeEngine() });
    assert.strictEqual(await rec.getSummary(), null);
    assert.strictEqual(fs.existsSync(activityDir), false);
    assert.strictEqual(recorder.isEnabled(), false);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });

  it("records categories from detector snapshots once enabled", async () => {
    const { clock, engine, recorder } = setup();
    await recorder.enable();
    clock.advance(60000);
    engine.snapshot = { textFocused: true, mediaPlaying: false };
    engine.emit();
    clock.advance(120000);
    recorder.sample();
    const s = await recorder.getSummary();
    assert.strictEqual(s.today.totalsMs.idle, 60000);
    assert.strictEqual(s.today.totalsMs.typing, 120000);
    await recorder.disable();
  });

  it("stops sampling, unsubscribes, and persists on disable", async () => {
    const { dir, clock, engine, power, timers, recorder } = setup();
    await recorder.enable();
    clock.advance(30000);
    await recorder.disable();
    assert.strictEqual(timers.count(), 0);
    assert.strictEqual(engine.listenerCount(), 0);
    assert.strictEqual(power.listenerCount("suspend"), 0);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
    assert.strictEqual(saved.days["2026-10-26"].totalsMs.idle, 30000);
    clock.advance(30000);
    recorder.sample(); // ignored while disabled
    assert.strictEqual((await recorder.getSummary()).today.totalsMs.idle, 30000);
  });

  it("does not count time while the Mac is asleep or locked", async () => {
    const { clock, power, recorder } = setup();
    await recorder.enable();
    clock.advance(10000);
    power.emit("suspend");
    clock.advance(3600000);
    power.emit("resume");
    clock.advance(5000);
    recorder.sample();
    const s = await recorder.getSummary();
    assert.strictEqual(s.today.totalsMs.idle, 15000);
    await recorder.disable();
  });

  it("counts time without keyboard/mouse input as away (sleeping)", async () => {
    const { clock, recorder, setIdle } = setup();
    await recorder.enable();
    setIdle(300000);
    recorder.sample();
    clock.advance(20000);
    recorder.sample();
    assert.strictEqual((await recorder.getSummary()).today.totalsMs.sleeping, 20000);
    await recorder.disable();
  });

  it("survives enable/disable/enable while the store is loading (no leaked timers)", async () => {
    const { engine, power, timers, recorder } = setup();
    const a = recorder.enable();
    const b = recorder.disable();
    const c = recorder.enable();
    await Promise.all([a, b, c]);
    assert.strictEqual(recorder.isEnabled(), true);
    assert.strictEqual(timers.count(), 2, "exactly one sample + one flush timer");
    assert.strictEqual(engine.listenerCount(), 1);
    assert.strictEqual(power.listenerCount("suspend"), 1);
    await recorder.disable();
    assert.strictEqual(timers.count(), 0);
  });

  it("a flush racing deleteAll cannot resurrect deleted data", async () => {
    const { dir, clock, recorder } = setup();
    await recorder.enable();
    clock.advance(60000);
    await recorder.flush();
    const del = recorder.deleteAll();
    const fl = recorder.flush();
    await Promise.all([del, fl]);
    assert.ok(!fs.existsSync(path.join(dir, "history.json")), "history must stay deleted");
    await recorder.disable();
  });

  it("deleteAll erases files and in-memory progress", async () => {
    const { dir, clock, recorder } = setup();
    await recorder.enable();
    clock.advance(60000);
    await recorder.flush();
    await recorder.deleteAll();
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    const s = await recorder.getSummary();
    assert.strictEqual(s.today.trackedMs, 0);
    await recorder.disable();
  });
});

describe("summarizeHistory", () => {
  it("builds today, a 7-day trend, averages, and the peak hour", () => {
    const today = emptyDay();
    today.totalsMs.typing = 3600000;
    today.hourlyMs.typing[10] = 3600000;
    const yesterday = emptyDay();
    yesterday.totalsMs.listening = 1800000;
    const s = summarizeHistory({ "2026-10-26": today, "2026-10-25": yesterday }, at(2026, 10, 26, 15), 7);
    assert.strictEqual(s.today.date, "2026-10-26");
    assert.strictEqual(s.today.peakHour, 10);
    assert.strictEqual(s.trend.length, 7);
    assert.strictEqual(s.trend[6].date, "2026-10-26");
    assert.strictEqual(s.trend[5].date, "2026-10-25");
    assert.strictEqual(s.avgFocusedMs, (3600000 + 1800000) / 2);
  });

  it("handles an empty history", () => {
    const s = summarizeHistory({}, at(2026, 10, 26, 15));
    assert.strictEqual(s.today.trackedMs, 0);
    assert.strictEqual(s.today.peakHour, null);
    assert.strictEqual(s.avgFocusedMs, 0);
  });
});
