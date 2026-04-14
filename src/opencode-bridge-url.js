// Validates opencode plugin reverse-bridge URLs before http.request.
// Plugin binds Bun.serve to loopback only; reject anything else to avoid SSRF
// or bearer-token exfiltration from a forged POST /permission.

"use strict";

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  // Node's URL.hostname for IPv6 literals may be "[::1]" (with brackets).
  if (h === "[::1]") return true;
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/**
 * @param {string} bridgeUrl Base URL from the plugin, e.g. http://127.0.0.1:<port>
 * @returns {{ ok: true, parsed: URL } | { ok: false, reason: string }}
 */
function validateOpencodeBridgeBaseUrl(bridgeUrl) {
  if (typeof bridgeUrl !== "string" || !bridgeUrl.trim()) {
    return { ok: false, reason: "empty" };
  }
  let parsed;
  try {
    parsed = new URL(bridgeUrl.trim());
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials" };
  }
  if (!isLoopbackHost(parsed.hostname)) {
    return { ok: false, reason: "host" };
  }
  const p = parsed.pathname;
  if (p && p !== "/") {
    return { ok: false, reason: "path" };
  }
  return { ok: true, parsed };
}

/**
 * @param {string} bridgeUrl
 * @returns {{ ok: true, parsed: URL } | { ok: false, reason: string }}
 */
function bridgeReplyUrl(bridgeUrl) {
  const v = validateOpencodeBridgeBaseUrl(bridgeUrl);
  if (!v.ok) return v;
  const base = bridgeUrl.trim().replace(/\/$/, "");
  try {
    const parsed = new URL(`${base}/reply`);
    return { ok: true, parsed };
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
}

module.exports = {
  validateOpencodeBridgeBaseUrl,
  bridgeReplyUrl,
  isLoopbackHost,
};
