"use strict";

// Async process execution for activity detectors.
//
// Every call is non-blocking (child_process.execFile), bounded by a timeout,
// cancellable through an AbortSignal, and rejects with a ProbeError whose
// `kind` tells the poller how to back off.

const childProcess = require("child_process");

/** Failure categories understood by the poller. */
const ErrorKind = Object.freeze({
  TIMEOUT: "timeout",
  PERMISSION: "permission-denied",
  UNAVAILABLE: "unavailable",
  CANCELLED: "cancelled",
  ERROR: "error",
});

class ProbeError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = "ProbeError";
    this.kind = kind;
    if (detail !== undefined) this.detail = detail;
  }
}

// AppleScript / Apple Event error numbers that mean "the user has not granted
// a privacy permission". -1743: Automation (Apple Events) not authorized.
// -1719 / -25211: Accessibility ("assistive access") not granted.
const PERMISSION_CODES = new Set([-1743, -1719, -25211]);
// -600: application isn't running. -1728: can't get object (app/element gone).
const UNAVAILABLE_CODES = new Set([-600, -1728]);

/** Extract the trailing "(-1234)" error number osascript prints on stderr. */
function parseAppleScriptErrorNumber(stderr) {
  const m = /\((-?\d+)\)\s*$/.exec(String(stderr || "").trim());
  return m ? Number(m[1]) : null;
}

/** Map an AppleScript error number to an ErrorKind. */
function classifyAppleScriptError(code) {
  if (PERMISSION_CODES.has(code)) return ErrorKind.PERMISSION;
  if (UNAVAILABLE_CODES.has(code)) return ErrorKind.UNAVAILABLE;
  return ErrorKind.ERROR;
}

/** Map an execFile error (plus stderr) to a ProbeError. */
function toProbeError(err, stderr, file) {
  if (err && err.name === "AbortError") return new ProbeError(ErrorKind.CANCELLED, `${file} cancelled`);
  if (err && err.code === "ENOENT") return new ProbeError(ErrorKind.UNAVAILABLE, `${file} not found`);
  // execFile's own timeout kills the child and reports killed=true
  if (err && err.killed) return new ProbeError(ErrorKind.TIMEOUT, `${file} timed out`);
  const code = parseAppleScriptErrorNumber(stderr);
  if (code !== null) {
    return new ProbeError(classifyAppleScriptError(code), `${file} failed (${code})`, { code });
  }
  return new ProbeError(ErrorKind.ERROR, `${file} failed: ${(err && err.message) || "unknown error"}`);
}

/**
 * Run a command without blocking the event loop.
 * Resolves with trimmed stdout; rejects with ProbeError.
 * Non-zero exit with `okExitCodes` (e.g. pgrep's 1 = "no match") resolves.
 */
function run(file, args, { timeoutMs, signal, maxBuffer = 16 * 1024, okExitCodes = [], execFile = childProcess.execFile } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new ProbeError(ErrorKind.CANCELLED, `${file} cancelled`));
      return;
    }
    execFile(file, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer,
      windowsHide: true,
      signal,
    }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout).trim());
      if (typeof err.code === "number" && okExitCodes.includes(err.code)) {
        return resolve(String(stdout || "").trim());
      }
      reject(toProbeError(err, stderr, file));
    });
  });
}

function runAppleScript(script, opts = {}) {
  return run("osascript", ["-e", script], opts);
}

module.exports = {
  ErrorKind,
  ProbeError,
  parseAppleScriptErrorNumber,
  classifyAppleScriptError,
  toProbeError,
  run,
  runAppleScript,
};
