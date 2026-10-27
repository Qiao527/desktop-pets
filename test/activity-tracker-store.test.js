const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { categorize, createTracker, mergeDays } = require("../src/activity/tracker");
const { createStore, SCHEMA_VERSION } = require("../src/activity/store");

const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

describe("categorize", () => {
  it("applies priority and ignores time while the system is paused", () => {
    assert.strictEqual(categorize({ systemPaused: true, textFocused: true }), null);
    assert.strictEqual(categorize({ doNotDisturb: true, textFocused: true }), "sleeping");
    assert.strictEqual(categorize({ textFocused: true, mediaPlaying: true }), "typing");
    assert.strictEqual(categorize({ mediaPlaying: true, agentBusy: true }), "listening");
    assert.strictEqual(categorize({ agentBusy: true }), "agent");
    assert.strictEqual(categorize({}), "idle");
  });

  it("uses OS input idle time, so typing counts even while the pet dozes", () => {
    assert.strictEqual(categorize({ userIdleMs: 5000, textFocused: true }), "typing");
    assert.strictEqual(categorize({ userIdleMs: 120000, textFocused: true }), "sleeping", "focused field but away");
    assert.strictEqual(categorize({ userIdleMs: 600000, mediaPlaying: true }), "listening");
    assert.strictEqual(categorize({ userIdleMs: 600000, agentBusy: true }), "agent");
    assert.strictEqual(categorize({ userIdleMs: 600000 }), "sleeping");
    assert.strictEqual(categorize({ userIdleMs: 119999 }), "idle");
  });
});

describe("tracker", () => {
  it("credits segments and suppresses duplicate observations", () => {
    let t = at(2026, 10, 26, 9);
    const tr = createTracker({ now: () => t });
    tr.observe("typing");
    t += 30000; tr.observe("typing");
    t += 30000; tr.observe("idle");
    t += 60000; tr.pause();
    const days = tr.drain();
    assert.strictEqual(days["2026-10-26"].totalsMs.typing, 60000);
    assert.strictEqual(days["2026-10-26"].totalsMs.idle, 60000);
    assert.strictEqual(days["2026-10-26"].hourlyMs.typing[9], 60000);
  });

  it("splits a segment across local midnight", () => {
    let t = at(2026, 10, 26, 23, 50);
    const tr = createTracker({ now: () => t, maxGapMs: Infinity });
    tr.observe("listening");
    t = at(2026, 10, 27, 0, 15);
    tr.pause();
    const days = tr.drain();
    assert.strictEqual(days["2026-10-26"].totalsMs.listening, 10 * 60000);
    assert.strictEqual(days["2026-10-27"].totalsMs.listening, 15 * 60000);
  });

  it("keeps totals exact across a DST fall-back day", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 2026-11-01 01:59:59 EDT is followed by 01:00:00 EST.
      let t = new Date("2026-11-01T00:30:00-04:00").getTime();
      const tr = createTracker({ now: () => t, maxGapMs: Infinity });
      tr.observe("typing");
      t = new Date("2026-11-01T02:30:00-05:00").getTime(); // 3 real hours later
      tr.pause();
      const d = tr.drain()["2026-11-01"];
      assert.strictEqual(d.totalsMs.typing, 3 * 3600000);
      assert.strictEqual(d.hourlyMs.typing[0], 30 * 60000);
      assert.strictEqual(d.hourlyMs.typing[1], 2 * 3600000, "both 1 AM hours");
      assert.strictEqual(d.hourlyMs.typing[2], 30 * 60000);
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });

  it("drops gaps longer than maxGapMs (missed sleep events)", () => {
    let t = at(2026, 10, 26, 10);
    const tr = createTracker({ now: () => t, maxGapMs: 120000 });
    tr.observe("typing");
    t += 60000; tr.observe("typing");
    t += 3600000; tr.observe("idle"); // frozen for an hour
    t += 1000; tr.pause();
    const d = tr.drain()["2026-10-26"];
    assert.strictEqual(d.totalsMs.typing, 60000);
    assert.strictEqual(d.totalsMs.idle, 1000);
  });

  it("discards the open segment when the clock moves backwards", () => {
    let t = at(2026, 10, 26, 10);
    const tr = createTracker({ now: () => t });
    tr.observe("typing");
    t -= 5000; tr.observe("idle");
    t += 2000; tr.pause();
    const d = tr.drain()["2026-10-26"];
    assert.strictEqual(d.totalsMs.typing, 0);
    assert.strictEqual(d.totalsMs.idle, 2000);
  });

  it("drain() credits the open segment without double counting", () => {
    let t = at(2026, 10, 26, 10);
    const tr = createTracker({ now: () => t });
    tr.observe("agent");
    t += 10000;
    const a = tr.drain();
    t += 5000; tr.pause();
    const b = tr.drain();
    const total = mergeDays(mergeDays({}, a), b)["2026-10-26"].totalsMs.agent;
    assert.strictEqual(total, 15000);
  });
});

describe("store", () => {
  const mk = (now = at(2026, 10, 26, 12)) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-store-"));
    return { dir, store: createStore({ dir, now: () => now, retentionDays: 90 }) };
  };

  it("starts empty, saves atomically with 0600 permissions, and reloads", async () => {
    const { dir, store } = mk();
    await store.load();
    assert.strictEqual(store.getLoadInfo().source, "new");
    let t = at(2026, 10, 26, 9);
    const tr = createTracker({ now: () => t });
    tr.observe("typing"); t += 1000; tr.pause();
    store.update((doc) => mergeDays(doc.days, tr.drain()));
    await store.save();
    assert.strictEqual(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.ok(!fs.readdirSync(dir).some((n) => n.includes(".tmp-")));
    const again = createStore({ dir, now: () => at(2026, 10, 26, 12) });
    const doc = await again.load();
    assert.strictEqual(doc.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(doc.days["2026-10-26"].totalsMs.typing, 1000);
  });

  it("quarantines a corrupt file and recovers from the last good backup", async () => {
    const { dir, store } = mk();
    await store.load();
    store.update((doc) => { doc.days["2026-10-26"] = require("../src/activity/tracker").emptyDay(); doc.days["2026-10-26"].totalsMs.idle = 42; });
    await store.save();
    await createStore({ dir }).load(); // a clean load refreshes history.json.bak
    fs.writeFileSync(store.file, "{ not json");
    const s2 = createStore({ dir, now: () => at(2026, 10, 26, 12) });
    const doc = await s2.load();
    assert.strictEqual(s2.getLoadInfo().recoveredFrom, "backup");
    assert.strictEqual(doc.days["2026-10-26"].totalsMs.idle, 42);
    assert.ok(fs.readdirSync(dir).some((n) => n.startsWith("history.corrupt-")));
  });

  it("refuses to modify a file written by a newer schema", async () => {
    const { dir, store } = mk();
    fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, days: {} }));
    await store.load();
    assert.strictEqual(store.isReadOnly(), true);
    assert.strictEqual(await store.save(), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(store.file, "utf8")).schemaVersion, SCHEMA_VERSION + 1);
  });

  it("prunes days beyond the retention window", async () => {
    const { dir } = mk();
    const { emptyDay } = require("../src/activity/tracker");
    fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify({
      schemaVersion: 1, days: { "2026-01-01": emptyDay(), "2026-10-25": emptyDay() },
    }));
    const doc = await createStore({ dir, now: () => at(2026, 10, 26, 12), retentionDays: 90 }).load();
    assert.deepStrictEqual(Object.keys(doc.days), ["2026-10-25"]);
  });

  it("deleteAll removes history, backups, and quarantined files", async () => {
    const { dir, store } = mk();
    await store.load();
    await store.save();
    await createStore({ dir }).load();
    fs.writeFileSync(path.join(dir, "history.corrupt-1.json"), "x");
    await store.deleteAll();
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });

  it("serializes concurrent saves", async () => {
    const { store } = mk();
    await store.load();
    const results = await Promise.all([store.save(), store.save(), store.save()]);
    assert.ok(results.every(Boolean));
  });
});
