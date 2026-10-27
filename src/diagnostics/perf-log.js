"use strict";

// Opt-in main-process performance sampler used for benchmarking.
// Enabled only when DESKTOP_PETS_PERF_LOG=<file> is set; otherwise a no-op.
// Each line of the output file is one JSON sample covering `intervalMs`.

const fs = require("fs");
const { monitorEventLoopDelay } = require("perf_hooks");

const NS_PER_MS = 1e6;

function round(n) {
  return Math.round(n * 100) / 100;
}

function startPerfLog({ file = process.env.DESKTOP_PETS_PERF_LOG, intervalMs = 10000, label = "", extra = null } = {}) {
  if (!file) return { stop() {} };

  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  const startedAt = Date.now();

  function sample() {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(lastCpu);
    const wallMs = Number(now - lastAt) / NS_PER_MS;
    const mem = process.memoryUsage();
    const line = {
      t: Date.now() - startedAt,
      label,
      eventLoopDelayMs: {
        p50: round(histogram.percentile(50) / NS_PER_MS),
        p99: round(histogram.percentile(99) / NS_PER_MS),
        max: round(histogram.max / NS_PER_MS),
        mean: round(histogram.mean / NS_PER_MS),
      },
      mainCpuPercent: round(((cpu.user + cpu.system) / 1000 / wallMs) * 100),
      rssMb: round(mem.rss / 1048576),
      heapUsedMb: round(mem.heapUsed / 1048576),
    };
    if (extra) {
      try { line.extra = extra(); } catch (err) { line.extra = { error: err.message }; }
    }
    try { fs.appendFileSync(file, JSON.stringify(line) + "\n"); } catch {}
    histogram.reset();
    lastCpu = process.cpuUsage();
    lastAt = now;
  }

  const timer = setInterval(sample, intervalMs);
  if (timer.unref) timer.unref();

  return {
    stop() {
      clearInterval(timer);
      histogram.disable();
    },
  };
}

module.exports = { startPerfLog };
