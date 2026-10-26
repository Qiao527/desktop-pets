const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startPerfLog } = require("../src/diagnostics/perf-log");

describe("perf-log", () => {
  it("is a no-op without a target file", () => {
    const log = startPerfLog({ file: undefined });
    assert.strictEqual(typeof log.stop, "function");
    log.stop();
  });

  it("appends one JSON sample per interval", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-perf-"));
    const file = path.join(dir, "perf.jsonl");
    const log = startPerfLog({ file, intervalMs: 40, label: "test", extra: () => ({ ok: 1 }) });
    await new Promise((r) => setTimeout(r, 150));
    log.stop();
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines.length >= 2, `expected >= 2 samples, got ${lines.length}`);
    for (const s of lines) {
      assert.strictEqual(s.label, "test");
      assert.deepStrictEqual(s.extra, { ok: 1 });
      assert.ok(s.eventLoopDelayMs.p99 >= s.eventLoopDelayMs.p50);
      assert.ok(s.rssMb > 0);
      assert.ok(Number.isFinite(s.mainCpuPercent));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
