const { describe, it } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { checkLocalRequest } = require("../src/local-request-guard");

const hook = (extra = {}) => ({
  method: "POST",
  headers: { host: "127.0.0.1:23333", "content-type": "application/json", ...extra },
});

describe("local request guard", () => {
  it("accepts hook-style requests", () => {
    assert.strictEqual(checkLocalRequest(hook()), null);
    assert.strictEqual(checkLocalRequest(hook({ host: "localhost:23334", "content-type": "application/json; charset=utf-8" })), null);
    assert.strictEqual(checkLocalRequest({ method: "GET", headers: { host: "127.0.0.1:23333" } }), null);
  });

  it("rejects browser requests by Origin or Sec-Fetch-Site", () => {
    assert.strictEqual(checkLocalRequest(hook({ origin: "https://evil.example" })).status, 403);
    assert.strictEqual(checkLocalRequest(hook({ origin: "null" })).status, 403);
    assert.strictEqual(checkLocalRequest(hook({ "sec-fetch-site": "cross-site" })).status, 403);
  });

  it("rejects non-loopback Host headers (DNS rebinding)", () => {
    for (const host of ["evil.example:23333", "127.0.0.1.evil.example", "", "192.168.1.5:23333"]) {
      assert.strictEqual(checkLocalRequest(hook({ host })).status, 403, host);
    }
  });

  it("rejects CORS-simple content types on POST", () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""]) {
      assert.strictEqual(checkLocalRequest(hook({ "content-type": ct })).status, 415, ct);
    }
  });

  it("is enforced by a real http.Server using the same check", async () => {
    const server = http.createServer((req, res) => {
      const r = checkLocalRequest(req);
      res.writeHead(r ? r.status : 200);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const send = (headers) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/state", headers }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end("{}");
    });
    assert.strictEqual(await send({ "Content-Type": "application/json" }), 200);
    assert.strictEqual(await send({ "Content-Type": "text/plain", Origin: "https://evil.example" }), 403);
    assert.strictEqual(await send({ "Content-Type": "text/plain" }), 415);
    await new Promise((resolve) => server.close(resolve));
  });
});
