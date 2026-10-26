const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  parseTextFocus, parseRunningProcesses, playerStateScript, textFocusDetector, mediaDetector, TEXT_FOCUS_SCRIPT,
} = require("../src/activity/detectors");
const { ErrorKind, ProbeError } = require("../src/activity/exec");

describe("text focus detector", () => {
  it("recognizes text-like accessibility roles", () => {
    for (const role of ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXSecureTextField"]) {
      assert.strictEqual(parseTextFocus(role), true, role);
    }
    for (const out of ["", "AXButton", "AXWindow", "AXWebArea"]) assert.strictEqual(parseTextFocus(out), false, out);
  });

  it("surfaces missing Accessibility permission instead of reporting 'not typing'", () => {
    assert.throws(() => parseTextFocus("ERR:-25211"), (e) => e.kind === ErrorKind.PERMISSION);
    assert.throws(() => parseTextFocus("ERR:-1719"), (e) => e.kind === ErrorKind.PERMISSION);
    assert.strictEqual(parseTextFocus("ERR:-1728"), false);
  });

  it("only reports the focused element's role, never its contents", () => {
    assert.ok(/role of fe/.test(TEXT_FOCUS_SCRIPT));
    assert.ok(!/AXValue|value of fe|AXSelectedText/.test(TEXT_FOCUS_SCRIPT));
  });

  it("forwards signal and timeout to the script runner", async () => {
    let opts;
    const det = textFocusDetector({ runScript: async (_s, o) => { opts = o; return "AXTextArea"; } });
    const ac = new AbortController();
    assert.strictEqual(await det.probe({ signal: ac.signal, timeoutMs: 1200 }), true);
    assert.strictEqual(opts.signal, ac.signal);
    assert.strictEqual(opts.timeoutMs, 1200);
  });
});

describe("media detector", () => {
  function makeMedia({ running = "", states = {}, failures = {} } = {}) {
    const scripts = [];
    let pgrepOpts;
    const det = mediaDetector({
      runCommand: async (file, args, opts) => { assert.strictEqual(file, "pgrep"); pgrepOpts = opts; return running; },
      runScript: async (script) => {
        scripts.push(script);
        const app = /application "(\w+)"/.exec(script)[1];
        if (failures[app]) throw failures[app];
        return states[app];
      },
    });
    return { det, scripts, pgrepOpts: () => pgrepOpts };
  }

  it("never sends Apple events when no player is running (cannot launch apps)", async () => {
    const { det, scripts, pgrepOpts } = makeMedia({ running: "" });
    assert.strictEqual(await det.probe({ timeoutMs: 2000 }), false);
    assert.deepStrictEqual(scripts, []);
    assert.deepStrictEqual(pgrepOpts().okExitCodes, [1]);
  });

  it("queries only running players", async () => {
    const { det, scripts } = makeMedia({ running: "6715 Spotify\n", states: { Spotify: "paused" } });
    assert.strictEqual(await det.probe({ timeoutMs: 2000 }), false);
    assert.strictEqual(scripts.length, 1);
    assert.ok(scripts[0].includes('"Spotify"'));
  });

  it("re-checks `is running` inside AppleScript before every tell", () => {
    for (const app of ["Music", "Spotify"]) {
      const s = playerStateScript(app);
      assert.ok(s.indexOf(`if application "${app}" is running`) < s.indexOf(`tell application "${app}"`));
    }
  });

  it("reports playing if any running player is playing", async () => {
    const { det } = makeMedia({ running: "1 Music\n2 Spotify\n", states: { Music: "paused", Spotify: "playing" } });
    assert.strictEqual(await det.probe({ timeoutMs: 2000 }), true);
  });

  it("tolerates one failing player when another answered", async () => {
    const { det } = makeMedia({
      running: "1 Music\n2 Spotify\n",
      states: { Spotify: "paused" },
      failures: { Music: new ProbeError(ErrorKind.TIMEOUT, "t") },
    });
    assert.strictEqual(await det.probe({ timeoutMs: 2000 }), false);
  });

  it("prefers the permission error when every player failed", async () => {
    const { det } = makeMedia({
      running: "1 Music\n2 Spotify\n",
      failures: {
        Music: new ProbeError(ErrorKind.TIMEOUT, "t"),
        Spotify: new ProbeError(ErrorKind.PERMISSION, "denied"),
      },
    });
    await assert.rejects(det.probe({ timeoutMs: 2000 }), { kind: ErrorKind.PERMISSION });
  });

  it("parses pgrep -l output", () => {
    assert.deepStrictEqual([...parseRunningProcesses("6715 Spotify\n73784 Music\n")], ["Spotify", "Music"]);
    assert.deepStrictEqual([...parseRunningProcesses("")], []);
  });
});
