// test/opencode-bridge-url.test.js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  validateOpencodeBridgeBaseUrl,
  bridgeReplyUrl,
} = require("../src/opencode-bridge-url");

describe("opencode bridge URL validation", () => {
  it("accepts http://127.0.0.1 with port", () => {
    const r = validateOpencodeBridgeBaseUrl("http://127.0.0.1:45231");
    assert.strictEqual(r.ok, true);
  });

  it("accepts http://127.0.0.1/ with trailing slash", () => {
    const r = validateOpencodeBridgeBaseUrl("http://127.0.0.1:8080/");
    assert.strictEqual(r.ok, true);
  });

  it("accepts localhost and ::1", () => {
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://localhost:3000").ok, true);
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://[::1]:4000").ok, true);
  });

  it("rejects non-loopback hosts", () => {
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://192.168.1.1:1").ok, false);
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://example.com").ok, false);
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://127.0.0.1.evil.com:1").ok, false);
  });

  it("rejects non-http(s) protocols", () => {
    assert.strictEqual(validateOpencodeBridgeBaseUrl("ftp://127.0.0.1:1").ok, false);
  });

  it("rejects userinfo in URL", () => {
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://user@127.0.0.1:1").ok, false);
  });

  it("rejects path other than root", () => {
    assert.strictEqual(validateOpencodeBridgeBaseUrl("http://127.0.0.1:1/foo").ok, false);
  });

  it("bridgeReplyUrl appends /reply", () => {
    const r = bridgeReplyUrl("http://127.0.0.1:9999");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.parsed.pathname, "/reply");
    assert.strictEqual(r.parsed.href, "http://127.0.0.1:9999/reply");
  });
});
