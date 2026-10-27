"use strict";

// Browser-origin safeguards for the loopback hook server (127.0.0.1:23333).
//
// The server is only meant for local agent hooks (Node/Bun processes and
// Claude Code HTTP hooks). Web pages in the user's browser can also reach
// 127.0.0.1, so requests are rejected when they:
//  - carry an Origin or Sec-Fetch-Site header (sent by browsers, not hooks);
//  - use a Host other than a loopback name (blocks DNS rebinding);
//  - POST without Content-Type: application/json (a browser can only send
//    that cross-origin after a CORS preflight, which this server never grants).

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

/** Returns null if the request is acceptable, else { status, reason }. */
function checkLocalRequest(req) {
  const headers = (req && req.headers) || {};
  if (headers.origin !== undefined) return { status: 403, reason: "browser origin not allowed" };
  if (headers["sec-fetch-site"] !== undefined) return { status: 403, reason: "browser request not allowed" };
  if (!LOOPBACK_HOST.test(String(headers.host || ""))) return { status: 403, reason: "non-loopback host" };
  if (req.method === "POST") {
    const type = String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return { status: 415, reason: "content-type must be application/json" };
  }
  return null;
}

module.exports = { checkLocalRequest };
