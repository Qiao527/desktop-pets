const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");
const { createActivityEngine } = require("../src/activity/engine");
const { typingTransition, mediaTransition } = require("../src/activity/pet-activity");
const { createFakeClock } = require("./helpers/fake-clock");

function fakeDetectors(readings) {
  const calls = { textFocused: 0, mediaPlaying: 0 };
  const def = (key, name) => ({
    name,
    intervalMs: 100,
    idleIntervalMs: 1000,
    timeoutMs: 500,
    probe: async () => { calls[key]++; return readings[key]; },
  });
  return { calls, detectors: { textFocused: def("textFocused", "textFocus"), mediaPlaying: def("mediaPlaying", "media") } };
}

describe("activity engine", () => {
  it("is inert on non-macOS platforms", () => {
    const engine = createActivityEngine({ platform: "linux" });
    engine.start();
    assert.strictEqual(engine.supported, false);
    assert.deepStrictEqual(engine.getSnapshot(), { textFocused: false, mediaPlaying: false });
    assert.deepStrictEqual(engine.getHealth(), []);
    engine.stop();
  });

  it("publishes snapshot changes to subscribers", async () => {
    const clock = createFakeClock();
    const readings = { textFocused: true, mediaPlaying: false };
    const { detectors } = fakeDetectors(readings);
    const engine = createActivityEngine({ platform: "darwin", detectors, clock });
    const seen = [];
    const unsubscribe = engine.onChange((s) => seen.push(s));
    engine.start();
    await clock.advance(0);
    assert.deepStrictEqual(engine.getSnapshot(), { textFocused: true, mediaPlaying: false });
    readings.mediaPlaying = true;
    await clock.advance(100);
    assert.deepStrictEqual(seen.at(-1), { textFocused: true, mediaPlaying: true });
    unsubscribe();
    readings.textFocused = false;
    const before = seen.length;
    await clock.advance(100);
    assert.strictEqual(seen.length, before, "unsubscribed listener must not be called");
    engine.stop();
  });

  it("pauses across suspend and lock, resuming only when both clear", async () => {
    const clock = createFakeClock();
    const power = new EventEmitter();
    const readings = { textFocused: true, mediaPlaying: true };
    const { detectors, calls } = fakeDetectors(readings);
    const engine = createActivityEngine({ platform: "darwin", detectors, clock, powerMonitor: power });
    engine.start();
    await clock.advance(0);
    assert.strictEqual(engine.getSnapshot().textFocused, true);

    power.emit("lock-screen");
    power.emit("suspend");
    assert.deepStrictEqual(engine.getSnapshot(), { textFocused: false, mediaPlaying: false });
    const frozen = calls.textFocused;
    await clock.advance(5000);
    assert.strictEqual(calls.textFocused, frozen, "no polling while asleep");

    power.emit("resume");
    await clock.advance(1000);
    assert.strictEqual(calls.textFocused, frozen, "still locked");
    assert.deepStrictEqual(engine.getPauseReasons(), ["locked"]);

    power.emit("unlock-screen");
    await clock.advance(0);
    assert.ok(calls.textFocused > frozen);
    assert.strictEqual(engine.getSnapshot().textFocused, true);
    engine.stop();
  });

  it("removes its powerMonitor listeners on stop", () => {
    const power = new EventEmitter();
    const { detectors } = fakeDetectors({ textFocused: false, mediaPlaying: false });
    const engine = createActivityEngine({ platform: "darwin", detectors, clock: createFakeClock(), powerMonitor: power });
    engine.start();
    assert.ok(power.listenerCount("suspend") > 0);
    engine.stop();
    for (const e of ["suspend", "resume", "lock-screen", "unlock-screen"]) assert.strictEqual(power.listenerCount(e), 0, e);
  });

  it("polls slowly while nothing observes the readings", async () => {
    const clock = createFakeClock();
    let observed = false;
    const { detectors, calls } = fakeDetectors({ textFocused: false, mediaPlaying: false });
    const engine = createActivityEngine({ platform: "darwin", detectors, clock, isObserved: () => observed });
    engine.start();
    await clock.advance(999);
    assert.strictEqual(calls.textFocused, 1);
    await clock.advance(1);
    assert.strictEqual(calls.textFocused, 2);
    observed = true;
    engine.refresh();
    await clock.advance(300);
    assert.ok(calls.textFocused >= 5, `fast interval resumes, got ${calls.textFocused}`);
    engine.stop();
  });

  it("exposes per-detector health", async () => {
    const clock = createFakeClock();
    const { detectors } = fakeDetectors({ textFocused: false, mediaPlaying: false });
    const engine = createActivityEngine({ platform: "darwin", detectors, clock });
    engine.start();
    await clock.advance(0);
    const names = engine.getHealth().map((h) => [h.name, h.status]);
    assert.deepStrictEqual(names, [["textFocus", "ok"], ["media", "ok"]]);
    engine.stop();
  });
});

// Regression table for the desktop-pet rules extracted from src/tick.js.
describe("pet activity transitions (legacy behavior)", () => {
  const T = (currentState, textFocused, mediaPlaying, beforeTypingVariant = "idle") =>
    typingTransition({ currentState, textFocused, mediaPlaying, beforeTypingVariant });
  const M = (currentState, textFocused, mediaPlaying) => mediaTransition({ currentState, textFocused, mediaPlaying });

  it("enters typing from idle, idle2 and listening, remembering the variant", () => {
    assert.deepStrictEqual(T("idle", true, false), { state: "typing", beforeTypingVariant: "idle", clearShuffle: true });
    assert.deepStrictEqual(T("idle2", true, false), { state: "typing", beforeTypingVariant: "idle2", clearShuffle: true });
    assert.deepStrictEqual(T("listening", true, true), { state: "typing", beforeTypingVariant: "listening", clearShuffle: true });
  });

  it("does not enter typing from agent or sleep states", () => {
    for (const s of ["working", "thinking", "sleeping", "hover", "typing", "yawning"]) assert.strictEqual(T(s, true, false), null, s);
  });

  it("leaves typing back to the remembered variant", () => {
    assert.deepStrictEqual(T("typing", false, true, "listening"), { state: "listening", base: "listening" });
    assert.deepStrictEqual(T("typing", false, false, "listening"), { state: "idle", base: "idle" });
    assert.deepStrictEqual(T("typing", false, false, "idle2"), { state: "idle2", base: "idle2" });
    assert.deepStrictEqual(T("typing", false, true, "idle"), { state: "idle", base: "idle" });
  });

  it("listening follows media but yields to typing", () => {
    assert.deepStrictEqual(M("idle", false, true), { state: "listening", clearShuffle: true });
    assert.deepStrictEqual(M("idle2", false, true), { state: "listening", clearShuffle: true });
    assert.strictEqual(M("idle", true, true), null);
    assert.deepStrictEqual(M("listening", false, false), { state: "idle", base: "idle" });
    assert.strictEqual(M("working", false, true), null);
  });

  it("composes in tick order: typing ends, then media takes over in the same tick", () => {
    const first = T("typing", false, true, "idle");
    assert.strictEqual(first.state, "idle");
    assert.deepStrictEqual(M(first.state, false, true), { state: "listening", clearShuffle: true });
  });
});
