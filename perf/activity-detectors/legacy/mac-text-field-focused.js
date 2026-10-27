"use strict";

const { execFileSync } = require("child_process");

const TEXT_LIKE_ROLES = new Set([
  "AXTextField",
  "AXTextArea",
  "AXComboBox",
  "AXSearchField",
  "AXSecureTextField",
]);

/**
 * macOS only: true when the frontmost app's focused accessibility element
 * looks like a text field (typing context). Requires Accessibility permission
 * for the terminal / Clawd app in System Settings → Privacy & Security.
 */
function isFrontmostTextFieldFocusedSync() {
  if (process.platform !== "darwin") return false;
  const script = [
    "tell application \"System Events\"",
    "  tell (first application process whose frontmost is true)",
    "    try",
    "      set fe to value of attribute \"AXFocusedUIElement\" of it",
    "      if fe is missing value then return \"\"",
    "      return role of fe as text",
    "    on error",
    "      return \"\"",
    "    end try",
    "  end tell",
    "end tell",
  ].join("\n");
  try {
    const role = execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 1200,
      windowsHide: true,
      maxBuffer: 128,
    }).trim();
    return TEXT_LIKE_ROLES.has(role);
  } catch {
    return false;
  }
}

module.exports = { isFrontmostTextFieldFocusedSync };
