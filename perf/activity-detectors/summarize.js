#!/usr/bin/env node
// Summarize perf-log JSONL files produced with DESKTOP_PETS_PERF_LOG.
// Usage: node perf/activity-detectors/summarize.js <file.jsonl>... [--md]
"use strict";

const fs = require("fs");
const path = require("path");

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (n) => Math.round(n * 10) / 10;

function summarize(file) {
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const lag = rows.map((r) => r.eventLoopDelayMs);
  return {
    run: path.basename(file, ".jsonl"),
    windows: rows.length,
    p50Median: r1(median(lag.map((l) => l.p50))),
    p99Median: r1(median(lag.map((l) => l.p99))),
    maxWorst: r1(Math.max(...lag.map((l) => l.max))),
    meanOfMeans: r1(mean(lag.map((l) => l.mean))),
    windowsOver100ms: rows.filter((r) => r.eventLoopDelayMs.max > 100).length,
    cpuMean: r1(mean(rows.map((r) => r.mainCpuPercent))),
    rssMedianMb: r1(median(rows.map((r) => r.rssMb))),
    detectors: rows.at(-1).extra ? rows.at(-1).extra.detectors : null,
  };
}

const args = process.argv.slice(2);
const md = args.includes("--md");
const results = args.filter((a) => !a.startsWith("--")).map(summarize);

if (md) {
  console.log("| Run | 10s windows | Loop delay p50 (median) | p99 (median) | Worst max | Windows with max > 100 ms | Main CPU % (mean) | RSS MB (median) |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.run} | ${r.windows} | ${r.p50Median} ms | ${r.p99Median} ms | ${r.maxWorst} ms | ${r.windowsOver100ms}/${r.windows} | ${r.cpuMean} | ${r.rssMedianMb} |`);
  }
} else {
  console.log(JSON.stringify(results, null, 2));
}
