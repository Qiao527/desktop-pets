#!/usr/bin/env node
// Verify a packaged app.asar contains the default theme and notices, and
// none of the artwork that this fork must not redistribute.
// Usage: node scripts/check-package.js "<path to app.asar>"
"use strict";

const fs = require("fs");

function listAsar(file) {
  const buf = fs.readFileSync(file);
  // asar header: pickle(size) + pickle(json). The JSON length is at offset 12.
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString("utf8"));
  const out = [];
  (function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = `${prefix}/${name}`;
      out.push(p);
      if (child.files) walk(child, p);
    }
  })(header, "");
  return out;
}

const REQUIRED = ["/themes/pip/theme.json", "/themes/pip/assets/pip-idle-follow.svg", "/assets/sounds/pip-complete.wav", "/LICENSE", "/NOTICE.md"];
const FORBIDDEN = [/pochacco/i, /calico/i, /^\/themes\/clawd\//, /^\/themes\/template\//, /^\/assets\/svg\//, /^\/assets\/gif\//, /\.mp3$/];

const file = process.argv[2];
if (!file) { console.error("usage: check-package.js <app.asar>"); process.exit(2); }
const entries = listAsar(file);
const missing = REQUIRED.filter((r) => !entries.includes(r));
const forbidden = entries.filter((e) => FORBIDDEN.some((re) => re.test(e)));
console.log(`${entries.length} entries in ${file}`);
if (missing.length) console.error("missing:", missing);
if (forbidden.length) console.error("forbidden:", forbidden);
process.exit(missing.length || forbidden.length ? 1 : 0);
