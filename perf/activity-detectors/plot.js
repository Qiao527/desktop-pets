#!/usr/bin/env node
// Render the README benchmark chart (light + dark SVG) from perf-log JSONL.
// Usage: node perf/activity-detectors/plot.js <legacy.jsonl> <async.jsonl> <out-prefix>
// Writes <out-prefix>-light.svg and <out-prefix>-dark.svg.
"use strict";

const fs = require("fs");

const THEMES = {
  light: { surface: "#fcfcfb", text: "#0b0b0b", muted: "#52514e", grid: "#e4e3df", async: "#2a78d6", legacy: "#eb6834" },
  dark: { surface: "#1a1a19", text: "#f0efec", muted: "#c3c2b7", grid: "#3a3936", async: "#3987e5", legacy: "#d95926" },
};

const W = 800, H = 380;
const M = { top: 78, right: 150, bottom: 52, left: 70 };
const PW = W - M.left - M.right, PH = H - M.top - M.bottom;
const Y_MIN = 10, Y_MAX = 10000; // ms, log scale

function load(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r) => ({ t: r.t / 1000, max: r.eventLoopDelayMs.max }));
}

const x = (t, tMax) => M.left + (t / tMax) * PW;
const y = (ms) => {
  const v = Math.min(Y_MAX, Math.max(Y_MIN, ms));
  return M.top + PH - ((Math.log10(v) - Math.log10(Y_MIN)) / (Math.log10(Y_MAX) - Math.log10(Y_MIN))) * PH;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function render(legacy, asyncRun, theme) {
  const c = THEMES[theme];
  // Runs are whole minutes plus sampling jitter; round to the nearest minute
  const tMax = Math.max(60, Math.round(Math.max(...legacy.map((p) => p.t), ...asyncRun.map((p) => p.t)) / 60) * 60);
  const font = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"`;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">Worst main-thread stall per 10-second window: legacy vs async engine</title>`);
  const over = legacy.filter((p) => p.max > 100).length;
  out.push(`<desc id="d">Legacy synchronous build: ${over} of ${legacy.length} windows stalled over 100 ms, worst ${Math.round(Math.max(...legacy.map((p) => p.max)))} ms. Async engine: ${asyncRun.filter((p) => p.max > 100).length} of ${asyncRun.length} windows over 100 ms, worst ${Math.round(Math.max(...asyncRun.map((p) => p.max)))} ms.</desc>`);
  out.push(`<rect width="${W}" height="${H}" rx="12" fill="${c.surface}"/>`);
  out.push(`<text x="${M.left}" y="30" ${font} font-size="17" font-weight="600" fill="${c.text}">Worst main-thread stall per 10-second window</text>`);
  out.push(`<text x="${M.left}" y="52" ${font} font-size="13" fill="${c.muted}">Real app · Apple M1 · macOS 27.0.1 · 5-minute runs · log scale</text>`);

  // Grid + y labels
  for (const v of [10, 100, 1000, 10000]) {
    const yy = y(v).toFixed(1);
    out.push(`<line x1="${M.left}" x2="${M.left + PW}" y1="${yy}" y2="${yy}" stroke="${c.grid}" stroke-width="1"/>`);
    const label = v >= 1000 ? `${v / 1000} s` : `${v} ms`;
    out.push(`<text x="${M.left - 10}" y="${yy}" dy="4" text-anchor="end" ${font} font-size="12" fill="${c.muted}">${label}</text>`);
  }
  // 100 ms reference
  const y100 = y(100).toFixed(1);
  out.push(`<line x1="${M.left}" x2="${M.left + PW}" y1="${y100}" y2="${y100}" stroke="${c.muted}" stroke-width="1" stroke-dasharray="4 4"/>`);
  out.push(`<text x="${M.left + PW - 4}" y="${y100}" dy="-6" text-anchor="end" ${font} font-size="11" fill="${c.muted}">100 ms — perceptible lag threshold</text>`);
  // x labels
  for (let t = 0; t <= tMax; t += 60) {
    out.push(`<text x="${x(t, tMax).toFixed(1)}" y="${M.top + PH + 22}" text-anchor="middle" ${font} font-size="12" fill="${c.muted}">${t / 60} min</text>`);
  }

  const series = [
    { name: "Async engine", data: asyncRun, color: c.async },
    { name: "Legacy (sync AppleScript)", data: legacy, color: c.legacy },
  ];
  for (const s of series) {
    const pts = s.data.map((p) => `${x(p.t, tMax).toFixed(1)},${y(p.max).toFixed(1)}`).join(" ");
    out.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of s.data) {
      out.push(`<circle cx="${x(p.t, tMax).toFixed(1)}" cy="${y(p.max).toFixed(1)}" r="4" fill="${s.color}" stroke="${c.surface}" stroke-width="2"><title>${esc(s.name)} · ${Math.round(p.t)} s · ${Math.round(p.max)} ms</title></circle>`);
    }
    // direct label at the line end
    const last = s.data[s.data.length - 1];
    out.push(`<text x="${x(last.t, tMax) + 10}" y="${y(last.max)}" dy="4" ${font} font-size="12" font-weight="600" fill="${c.text}">${esc(s.name.split(" (")[0])}</text>`);
  }
  // legend (top right)
  let lx = M.left + PW - 330;
  for (const s of series) {
    out.push(`<rect x="${lx}" y="62" width="12" height="4" rx="2" fill="${s.color}"/>`);
    out.push(`<text x="${lx + 18}" y="68" ${font} font-size="12" fill="${c.text}">${esc(s.name)}</text>`);
    lx += s.name.length * 7 + 40;
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}

const [legacyFile, asyncFile, prefix] = process.argv.slice(2);
if (!prefix) {
  console.error("usage: plot.js <legacy.jsonl> <async.jsonl> <out-prefix>");
  process.exit(2);
}
const legacy = load(legacyFile);
const asyncRun = load(asyncFile);
for (const theme of Object.keys(THEMES)) {
  fs.writeFileSync(`${prefix}-${theme}.svg`, render(legacy, asyncRun, theme));
}
console.log(`wrote ${prefix}-light.svg and ${prefix}-dark.svg`);
