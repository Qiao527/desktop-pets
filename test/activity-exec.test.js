const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  ErrorKind, parseAppleScriptErrorNumber, classifyAppleScriptError, toProbeError, run,
} = require("../src/activity/exec");

describe("AppleScript error classification", () => {
  it("parses the trailing error number from osascript stderr", () => {
    assert.strictEqual(parseAppleScriptErrorNumber(
      "0:57: execution error: Not authorized to send Apple events to System Events. (-1743)\n"), -1743);
    assert.strictEqual(parseAppleScriptErrorNumber(
      "execution error: osascript is not allowed assistive access. (-25211)"), -25211);
    assert.strictEqual(parseAppleScriptErrorNumber("no number here"), null);
    assert.strictEqual(parseAppleScriptErrorNumber(undefined), null);
  });

  it("maps privacy errors to permission-denied and missing apps to unavailable", () => {
    assert.strictEqual(classifyAppleScriptError(-1743), ErrorKind.PERMISSION);
    assert.strictEqual(classifyAppleScriptError(-1719), ErrorKind.PERMISSION);
    assert.strictEqual(classifyAppleScriptError(-25211), ErrorKind.PERMISSION);
    assert.strictEqual(classifyAppleScriptError(-600), ErrorKind.UNAVAILABLE);
    assert.strictEqual(classifyAppleScriptError(-2753), ErrorKind.ERROR);
  });

  it("maps process-level failures", () => {
    assert.strictEqual(toProbeError({ killed: true, signal: "SIGKILL" }, "", "osascript").kind, ErrorKind.TIMEOUT);
    assert.strictEqual(toProbeError({ code: "ENOENT" }, "", "osascript").kind, ErrorKind.UNAVAILABLE);
    assert.strictEqual(toProbeError({ name: "AbortError" }, "", "osascript").kind, ErrorKind.CANCELLED);
    const e = toProbeError({ code: 1 }, "execution error: x (-1743)", "osascript");
    assert.strictEqual(e.kind, ErrorKind.PERMISSION);
    assert.strictEqual(e.detail.code, -1743);
    assert.strictEqual(toProbeError(new Error("weird"), "", "osascript").kind, ErrorKind.ERROR);
  });
});

describe("run() with an injected execFile", () => {
  it("trims stdout and passes timeout/kill options", async () => {
    let seen;
    const execFile = (file, args, opts, cb) => { seen = { file, args, opts }; cb(null, "  AXTextArea \n", ""); };
    const out = await run("osascript", ["-e", "x"], { timeoutMs: 1200, execFile });
    assert.strictEqual(out, "AXTextArea");
    assert.strictEqual(seen.opts.timeout, 1200);
    assert.strictEqual(seen.opts.killSignal, "SIGKILL");
  });

  it("resolves allowed non-zero exit codes (pgrep: 1 = no match)", async () => {
    const execFile = (_f, _a, _o, cb) => cb(Object.assign(new Error("exit 1"), { code: 1 }), "", "");
    assert.strictEqual(await run("pgrep", [], { timeoutMs: 100, okExitCodes: [1], execFile }), "");
    await assert.rejects(run("pgrep", [], { timeoutMs: 100, execFile }), { kind: ErrorKind.ERROR });
  });

  it("does not spawn when the signal is already aborted", async () => {
    let spawned = false;
    const execFile = () => { spawned = true; };
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(run("osascript", [], { timeoutMs: 100, signal: ac.signal, execFile }), { kind: ErrorKind.CANCELLED });
    assert.strictEqual(spawned, false);
  });
});

describe("run() with real child processes", () => {
  const node = process.execPath;

  it("kills a hung child at the timeout and classifies it", async () => {
    const t0 = Date.now();
    await assert.rejects(
      run(node, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 200 }),
      { kind: ErrorKind.TIMEOUT },
    );
    assert.ok(Date.now() - t0 < 3000, "timeout should fire promptly");
  });

  it("cancels a running child through AbortSignal", async () => {
    const ac = new AbortController();
    const p = run(node, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 5000, signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(p, { kind: ErrorKind.CANCELLED });
  });

  it("keeps the event loop responsive while a child runs", async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 10);
    await run(node, ["-e", "const end = Date.now() + 300; while (Date.now() < end) {}"], { timeoutMs: 5000 });
    clearInterval(timer);
    // A synchronous spawn would block for the whole 300ms and allow ~0 ticks.
    assert.ok(ticks >= 10, `expected the loop to keep ticking, got ${ticks}`);
  });

  it("reports a missing binary as unavailable", async () => {
    await assert.rejects(run("definitely-not-a-real-binary-xyz", [], { timeoutMs: 1000 }), { kind: ErrorKind.UNAVAILABLE });
  });
});
