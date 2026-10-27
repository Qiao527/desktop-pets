"use strict";

// Main-process side of the Activity Insights window.
//
// Security model:
//  - The renderer is sandboxed, context-isolated, has no Node integration,
//    runs in its own session partition (all permission requests denied),
//    cannot navigate or open windows, and loads only a local file with a
//    strict CSP.
//  - It can reach main only through four invoke channels. Every handler
//    verifies the sender is this window's own webContents and main frame at
//    the expected file:// URL, and validates argument types.
//  - Opening System Settings is limited to a fixed allowlist of panes.

const SETTINGS_PANES = Object.freeze({
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
});

const CHANNELS = Object.freeze({
  getState: "insights:get-state",
  setTracking: "insights:set-tracking",
  deleteAll: "insights:delete-all",
  openSettings: "insights:open-settings",
});

function stripUrl(u) {
  return String(u || "").split("#")[0].split("?")[0];
}

/** True only for IPC sent by `win`'s own top-level frame at `expectedUrl`. */
function isTrustedSender(event, win, expectedUrl) {
  if (!event || !win || (typeof win.isDestroyed === "function" && win.isDestroyed())) return false;
  const wc = win.webContents;
  if (!wc || event.sender !== wc) return false;
  const frame = event.senderFrame;
  if (!frame) return false;
  if (wc.mainFrame && frame !== wc.mainFrame) return false;
  return stripUrl(frame.url) === stripUrl(expectedUrl);
}

function createInsightsController({
  BrowserWindow,
  ipcMain,
  shell,
  recorder,
  engine,
  setTrackingEnabled,
  htmlPath,
  preloadPath,
  expectedUrl,
  isDev = false,
  backgroundColor = "#00000000",
}) {
  let win = null;

  function guard(event) {
    if (!isTrustedSender(event, win, expectedUrl)) throw new Error("insights: untrusted IPC sender");
  }

  async function getState() {
    const status = recorder.getStatus();
    return {
      platformSupported: !!engine.supported,
      tracking: {
        enabled: status.enabled,
        file: status.file,
        readOnly: status.readOnly,
        recoveredFrom: status.loadInfo ? status.loadInfo.recoveredFrom : null,
        loadError: status.loadError || (status.loadInfo && status.loadInfo.error) || null,
      },
      currentCategory: recorder.getCurrentCategory(),
      summary: await recorder.getSummary(7),
      detectors: engine.getHealth().map((h) => ({
        name: h.name,
        status: h.status,
        lastErrorKind: h.lastErrorKind,
        consecutiveFailures: h.consecutiveFailures,
        totalRuns: h.totalRuns,
        latencyMs: h.latencyMs,
        lastSuccessAt: h.lastSuccessAt,
      })),
      pauseReasons: engine.getPauseReasons(),
      generatedAt: Date.now(),
    };
  }

  const handlers = {
    [CHANNELS.getState]: async (event) => { guard(event); return getState(); },
    [CHANNELS.setTracking]: async (event, enabled) => {
      guard(event);
      if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      await setTrackingEnabled(enabled);
      return getState();
    },
    [CHANNELS.deleteAll]: async (event) => {
      guard(event);
      await recorder.deleteAll();
      return getState();
    },
    [CHANNELS.openSettings]: async (event, pane) => {
      guard(event);
      const url = Object.prototype.hasOwnProperty.call(SETTINGS_PANES, pane) ? SETTINGS_PANES[pane] : null;
      if (!url) throw new RangeError("unknown settings pane");
      await shell.openExternal(url);
      return true;
    },
  };

  function register() {
    for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, fn);
  }

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    win = new BrowserWindow({
      width: 780,
      height: 680,
      minWidth: 560,
      minHeight: 480,
      title: "Activity Insights",
      show: false,
      backgroundColor,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        devTools: isDev,
        partition: "insights",
      },
    });
    const wc = win.webContents;
    wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e) => e.preventDefault());
    wc.on("will-attach-webview", (e) => e.preventDefault());
    win.once("ready-to-show", () => win && !win.isDestroyed() && win.show());
    win.on("closed", () => { win = null; });
    win.loadFile(htmlPath);
    return win;
  }

  function dispose() {
    for (const ch of Object.keys(handlers)) ipcMain.removeHandler(ch);
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return { register, open, dispose, getWindow: () => win, handlers, getState };
}

module.exports = { createInsightsController, isTrustedSender, SETTINGS_PANES, CHANNELS };
