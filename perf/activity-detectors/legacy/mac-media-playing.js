"use strict";

const { execFileSync } = require("child_process");

function getPlayerState(app) {
  const out = execFileSync(
    "osascript",
    ["-e", `tell application "${app}" to get player state`],
    { encoding: "utf8", timeout: 2000, windowsHide: true, maxBuffer: 64 },
  ).trim();
  return out;
}

function isProcessRunning(exactName) {
  try {
    execFileSync("pgrep", ["-x", exactName], { stdio: "ignore", timeout: 400, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * macOS: Apple Music or (when running) Spotify reports player state "playing".
 */
function isMacMediaPlayingSync() {
  if (process.platform !== "darwin") return false;

  try {
    if (getPlayerState("Music") === "playing") return true;
  } catch { /* not running / denied */ }

  if (!isProcessRunning("Spotify")) return false;
  try {
    return getPlayerState("Spotify") === "playing";
  } catch {
    return false;
  }
}

module.exports = { isMacMediaPlayingSync };
