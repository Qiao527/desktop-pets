const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { createInsightsController, isTrustedSender, SETTINGS_PANES, CHANNELS } = require("../src/insights/controller");

const URL = "file:///app/src/insights/index.html";

function fakeWindowClass(created) {
  return class FakeWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      const mainFrame = { url: URL };
      this.handlers = {};
      this.webContents = {
        mainFrame,
        session: { setPermissionRequestHandler: (fn) => { this.permissionHandler = fn; } },
        setWindowOpenHandler: (fn) => { this.openHandler = fn; },
        on: (ev, fn) => { this.handlers[ev] = fn; },
      };
      created.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    once() {}
    on() {}
    show() {}
    focus() {}
    loadFile(p) { this.loaded = p; }
    destroy() { this.destroyed = true; }
  };
}

function setup() {
  const created = [];
  const opened = [];
  const ipcHandlers = new Map();
  let tracking = false;
  const ctrl = createInsightsController({
    BrowserWindow: fakeWindowClass(created),
    ipcMain: { handle: (ch, fn) => ipcHandlers.set(ch, fn), removeHandler: (ch) => ipcHandlers.delete(ch) },
    shell: { openExternal: async (u) => { opened.push(u); } },
    recorder: {
      getStatus: () => ({ enabled: tracking, file: "/x/history.json", readOnly: false, loadInfo: null }),
      getCurrentCategory: () => null,
      getSummary: async () => null,
      deleteAll: async () => {},
    },
    engine: { supported: true, getHealth: () => [], getPauseReasons: () => [] },
    setTrackingEnabled: async (v) => { tracking = v; },
    htmlPath: "/app/src/insights/index.html",
    preloadPath: "/app/src/preload-insights.js",
    expectedUrl: URL,
  });
  ctrl.register();
  const win = ctrl.open();
  const trusted = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  return { ctrl, win, created, opened, ipcHandlers, trusted, isTracking: () => tracking };
}

describe("insights window hardening", () => {
  it("creates a sandboxed, isolated window in its own partition", () => {
    const { win } = setup();
    const wp = win.opts.webPreferences;
    assert.strictEqual(wp.sandbox, true);
    assert.strictEqual(wp.contextIsolation, true);
    assert.strictEqual(wp.nodeIntegration, false);
    assert.strictEqual(wp.webviewTag, false);
    assert.strictEqual(wp.partition, "insights");
  });

  it("denies permissions, popups, and navigation", () => {
    const { win } = setup();
    let granted = null;
    win.permissionHandler(null, "media", (v) => { granted = v; });
    assert.strictEqual(granted, false);
    assert.deepStrictEqual(win.openHandler({ url: "https://example.com" }), { action: "deny" });
    let prevented = false;
    win.handlers["will-navigate"]({ preventDefault: () => { prevented = true; } });
    assert.strictEqual(prevented, true);
  });

  it("reuses a single window", () => {
    const { ctrl, created } = setup();
    ctrl.open();
    assert.strictEqual(created.length, 1);
  });

  it("ships a strict CSP and no inline script", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "src", "insights", "index.html"), "utf8");
    assert.ok(/default-src 'none'/.test(html));
    assert.ok(/script-src 'self'/.test(html));
    assert.ok(!/<script>[^<]/.test(html), "no inline scripts");
    const js = fs.readFileSync(path.join(__dirname, "..", "src", "insights", "insights.js"), "utf8");
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(js));
  });
});

describe("insights IPC sender validation", () => {
  it("accepts only this window's main frame at the expected URL", () => {
    const { win, trusted } = setup();
    assert.strictEqual(isTrustedSender(trusted, win, URL), true);
    assert.strictEqual(isTrustedSender({ ...trusted, sender: {} }, win, URL), false, "other webContents");
    assert.strictEqual(isTrustedSender({ ...trusted, senderFrame: { url: URL } }, win, URL), false, "subframe");
    win.webContents.mainFrame.url = "https://evil.example/";
    assert.strictEqual(isTrustedSender(trusted, win, URL), false, "navigated away");
    assert.strictEqual(isTrustedSender(trusted, null, URL), false);
  });

  it("rejects every channel from an untrusted sender", async () => {
    const { ipcHandlers, isTracking } = setup();
    const evil = { sender: {}, senderFrame: { url: URL } };
    for (const ch of Object.values(CHANNELS)) {
      await assert.rejects(ipcHandlers.get(ch)(evil, true), /untrusted/, ch);
    }
    assert.strictEqual(isTracking(), false);
  });

  it("validates argument types", async () => {
    const { ipcHandlers, trusted, isTracking } = setup();
    await assert.rejects(ipcHandlers.get(CHANNELS.setTracking)(trusted, "yes"), TypeError);
    assert.strictEqual(isTracking(), false);
    const state = await ipcHandlers.get(CHANNELS.setTracking)(trusted, true);
    assert.strictEqual(state.tracking.enabled, true);
  });

  it("opens only allowlisted System Settings panes", async () => {
    const { ipcHandlers, trusted, opened } = setup();
    await ipcHandlers.get(CHANNELS.openSettings)(trusted, "accessibility");
    assert.deepStrictEqual(opened, [SETTINGS_PANES.accessibility]);
    for (const bad of ["https://evil.example", "__proto__", "constructor", "file:///etc/passwd"]) {
      await assert.rejects(ipcHandlers.get(CHANNELS.openSettings)(trusted, bad), RangeError, bad);
    }
    assert.strictEqual(opened.length, 1);
  });

  it("removes its IPC handlers on dispose", () => {
    const { ctrl, ipcHandlers, win } = setup();
    ctrl.dispose();
    assert.strictEqual(ipcHandlers.size, 0);
    assert.strictEqual(win.destroyed, true);
  });
});
