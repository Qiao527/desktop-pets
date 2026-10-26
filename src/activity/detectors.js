"use strict";

// macOS activity detectors. Each detector is a plain description consumed by
// createPoller(): a probe plus its timing policy. Probes are async and never
// block the Electron main thread.

const { ErrorKind, ProbeError, run, runAppleScript } = require("./exec");

const TEXT_LIKE_ROLES = new Set([
  "AXTextField",
  "AXTextArea",
  "AXComboBox",
  "AXSearchField",
  "AXSecureTextField",
]);

// Accessibility errors raised inside the AX query are returned as "ERR:<n>"
// so permission problems are distinguishable from "no focused element".
const TEXT_FOCUS_SCRIPT = [
  "tell application \"System Events\"",
  "  set frontProc to first application process whose frontmost is true",
  "  try",
  "    set fe to value of attribute \"AXFocusedUIElement\" of frontProc",
  "    if fe is missing value then return \"\"",
  "    return role of fe as text",
  "  on error errMsg number errNum",
  "    return \"ERR:\" & errNum",
  "  end try",
  "end tell",
].join("\n");

const ACCESSIBILITY_ERROR_CODES = new Set([-1719, -25211]);

/** Interpret the text-focus script output. Throws ProbeError on permission errors. */
function parseTextFocus(output) {
  const out = String(output || "").trim();
  if (out.startsWith("ERR:")) {
    const code = Number(out.slice(4));
    if (ACCESSIBILITY_ERROR_CODES.has(code)) {
      throw new ProbeError(ErrorKind.PERMISSION, `Accessibility access not granted (${code})`, { code });
    }
    return false; // e.g. -1728: the app exposes no focused element
  }
  return TEXT_LIKE_ROLES.has(out);
}

function textFocusDetector({ runScript = runAppleScript } = {}) {
  return {
    name: "textFocus",
    intervalMs: 400,
    idleIntervalMs: 5000,
    timeoutMs: 1200,
    backoff: { baseMs: 1000, maxMs: 30000 },
    permissionRetryMs: 30000,
    probe: async ({ signal, timeoutMs }) =>
      parseTextFocus(await runScript(TEXT_FOCUS_SCRIPT, { signal, timeoutMs })),
  };
}

// Media players are queried only when already running. The `is running`
// guard is re-checked inside AppleScript right before `tell`, because a
// `tell` to an app that has quit would relaunch it.
const MEDIA_APPS = [
  { process: "Music", app: "Music" },
  { process: "Spotify", app: "Spotify" },
];

function playerStateScript(app) {
  return [
    `if application "${app}" is running then`,
    `  tell application "${app}" to return (player state as text)`,
    "end if",
    "return \"not-running\"",
  ].join("\n");
}

/** Parse `pgrep -lx` output into the set of running process names. */
function parseRunningProcesses(output) {
  const names = new Set();
  for (const line of String(output || "").split("\n")) {
    const m = /^\s*\d+\s+(.+?)\s*$/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

function mediaDetector({ runCommand = run, runScript = runAppleScript } = {}) {
  const pattern = MEDIA_APPS.map((a) => a.process).join("|");
  return {
    name: "media",
    intervalMs: 3000,
    idleIntervalMs: 10000,
    timeoutMs: 2000,
    backoff: { baseMs: 3000, maxMs: 60000 },
    permissionRetryMs: 60000,
    probe: async ({ signal, timeoutMs }) => {
      // pgrep exits 1 when nothing matches; that is a normal "no player" result.
      const running = parseRunningProcesses(
        await runCommand("pgrep", ["-lx", pattern], { signal, timeoutMs, okExitCodes: [1] }),
      );
      const targets = MEDIA_APPS.filter((a) => running.has(a.process));
      if (targets.length === 0) return false;

      const results = await Promise.allSettled(
        targets.map((a) => runScript(playerStateScript(a.app), { signal, timeoutMs })),
      );
      if (results.some((r) => r.status === "fulfilled" && r.value === "playing")) return true;
      const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
      if (failures.length === results.length) {
        // Prefer surfacing a permission problem: it is the one the user can fix.
        throw failures.find((e) => e && e.kind === ErrorKind.PERMISSION) || failures[0];
      }
      return false;
    },
  };
}

module.exports = {
  TEXT_LIKE_ROLES,
  TEXT_FOCUS_SCRIPT,
  MEDIA_APPS,
  parseTextFocus,
  parseRunningProcesses,
  playerStateScript,
  textFocusDetector,
  mediaDetector,
};
