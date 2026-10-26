# Benchmarks: Activity Detection on the Main Thread

## Question

Does moving the macOS activity detectors from synchronous `execFileSync`
calls on the Electron main thread to the asynchronous activity engine improve
main-thread responsiveness, and what does it cost?

## Setup

| | |
|---|---|
| Hardware | Apple M1 (MacBook), macOS 27.0.1 |
| Runtime | Electron 41 (from `npm ci`), launched with `npm start` |
| Legacy build | `30d52cc` — synchronous detectors + the perf sampler |
| Async build | `feat/activity-engine` with the cadence fix (`402ad3a`) for r3; r1/r2 used the build before the cadence fix (`d80fa35`) |
| App state | User prefs: desktop-pet mode on, Pochacco local theme, agent integration off, tracking off |
| Environment | Music and Spotify both running; Accessibility granted to the launching terminal; other foreground work kept minimal |
| Duration | 5 minutes per run, alternating legacy → async, 3 rounds |
| Sampler | `src/diagnostics/perf-log.js`: `perf_hooks.monitorEventLoopDelay` (10 ms resolution), `process.cpuUsage`, `process.memoryUsage`, one sample per 10 s window |

Runner: [`perf/activity-detectors/run-app.sh`](../perf/activity-detectors/run-app.sh).
Summary: [`perf/activity-detectors/summarize.js`](../perf/activity-detectors/summarize.js).
Raw data: [`perf/activity-detectors/results/2026-10-26-m1-macos27/`](../perf/activity-detectors/results/2026-10-26-m1-macos27/).

Event-loop delay is how late a timer fires. With a 10 ms sampling resolution,
a value of ~11–12 ms means "not delayed". `p99 (median)` is the median across
windows of each window's 99th percentile; `Worst max` is the single longest
stall in the run.

## Results

| Run | 10 s windows | Loop delay p50 | p99 (median) | Worst max | Windows with a stall > 100 ms | Main CPU % | RSS MB (median) |
|---|---|---|---|---|---|---|---|
| legacy-sync-r1 | 29 | 12.1 ms | 292.8 ms | 5054.1 ms | 29/29 | 2.2 | 38.8 |
| async-engine-r1 | 30 | 12.1 ms | 13.2 ms | 56.9 ms | **0/30** | 3.2 | 56.2 |
| legacy-sync-r2 | 29 | 12.1 ms | 248.9 ms | 647.0 ms | 29/29 | 2.5 | 50.9 |
| async-engine-r2 | 30 | 12.1 ms | 13.4 ms | 38.9 ms | **0/30** | 3.2 | 55.0 |
| legacy-sync-r3 | 30 | 12.1 ms | 285.9 ms | 1772.1 ms | 30/30 | 1.8 | 49.5 |
| async-engine-r3 † | 30 | 12.1 ms | 15.9 ms | 7268.7 ms | 6/30 | 2.6 | 47.2 |
| async-engine-r3, before lock † | 17 | — | ≤ 17.9 ms | 52.0 ms | **0/17** | — | — |

† The Mac auto-locked about 3 minutes into async r3 (confirmed with
`CGSSessionScreenIsLocked`). The engine received the lock event and paused
both detectors, as designed. The 7.3 s and 2.2 s stalls happen during the
lock transition, after the probes were already async and timing out
(System Events stopped answering). They therefore come from other
main-thread work during locking, most likely inherited window or cursor
calls, which has **not yet been investigated**. The legacy r3 run did not
include a lock, so the r3 pair is not a like-for-like comparison.

Detector health reported by the async build (r3, before the lock):

| Detector | Runs | Failures | Probe latency p50 / p95 |
|---|---|---|---|
| Text input focus | 465 | 3 timeouts (during lock) | 282 / 1214 ms |
| Media playback | 66 | 0 | 240 / 739 ms |

## Interpretation

- **Responsiveness.** In the three legacy runs, *every* 10-second window
  contained a main-thread stall over 100 ms. The median per-window p99 was
  249–293 ms, and single stalls reached 0.6–5.1 s. In the clean async runs,
  no window had a stall over 100 ms, and the median p99 was 13 ms.
- **Why.** Each `osascript` probe takes ~220–280 ms on this machine. The
  legacy code ran one every 400 ms *on* the main thread. The async engine
  runs the same probes in child processes and only reads a cached result.
- **Cost.** Main-process CPU is ~0.5–1 percentage point higher with the
  async build: pipe and callback handling runs on the main thread, whereas
  a blocked thread uses no CPU. Median RSS was higher in two of the three
  pairs. Run-to-run variation is large, so no firm memory conclusion is drawn.
- **Cadence.** r1/r2 used a build that waited 400 ms *after* each probe
  (~620 ms period). The cadence fix restores the legacy ~400 ms period;
  r3 shows 465 text-focus runs in ~200 s (≈ 430 ms period).
- **Startup / shutdown.** All runs started the HTTP server in 2.3–6.7 s
  (dominated by `npm` and Electron startup) and exited within 1.0 s of
  `SIGTERM`, removing `~/.clawd/runtime.json`. The sample size is too small
  to compare startup times between builds.

## Limitations

- One machine, one OS version, three pairs of 5-minute runs.
- Not measured: total CPU including the `osascript` child processes. Child
  processes run at the same rate in both builds.
- The legacy build launched Music when it was closed. Both players were kept
  running so both builds saw the same conditions.
- The text-focus probe latency depends on the frontmost app's accessibility
  tree; the frontmost app during these runs was a terminal.
