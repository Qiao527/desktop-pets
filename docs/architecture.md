# Architecture

Desktop Pets is an Electron app. Most of the application — windows, state
machine, agent hooks, themes — is inherited from
[clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) (see
[NOTICE.md](../NOTICE.md)). This document describes the whole system briefly and
the macOS Activity Intelligence subsystem added in this fork in detail.

## Process and window layout

```
Electron main process (Node)
├── src/main.js            app lifecycle, prefs, window creation, IPC wiring
├── src/state.js           pet state machine (priorities, min display, sleep sequence)   [upstream]
├── src/tick.js            50 ms loop: cursor, eye tracking, idle/sleep, hover           [upstream, modified]
├── src/server.js          127.0.0.1:23333 HTTP API for agent hooks                      [upstream, modified]
├── src/activity/          Activity Intelligence subsystem                               [this fork]
│   ├── exec.js            async execFile with timeout, cancellation, error classes
│   ├── poller.js          non-overlapping scheduler with backoff and health stats
│   ├── detectors.js       macOS text-focus and media-playback probes
│   ├── engine.js          owns pollers, sleep/lock pausing, cached snapshot
│   ├── pet-activity.js    typing/listening rules (pure, extracted from tick.js)
│   ├── tracker.js         category time accounting (pure, clock-injected)
│   ├── store.js           versioned atomic JSON store
│   ├── recorder.js        opt-in glue: engine + pet state -> tracker -> store
│   └── summary.js         view-model for the Insights window
├── src/insights/          Insights window: controller (main) + sandboxed UI       [this fork]
└── src/diagnostics/perf-log.js   opt-in event-loop/CPU/memory sampler              [this fork]

Renderer processes
├── pet render window      transparent, click-through, plays animations           [upstream]
├── pet input window       small hit-test window for clicks/drags                 [upstream]
├── permission bubbles     agent permission prompts                               [upstream]
└── Activity Insights      sandboxed, CSP-locked, preload-only API                [this fork]
```

## Activity Intelligence data flow

```
          every 400 ms / 3 s (adaptive, never overlapping)
┌────────────┐  async execFile   ┌──────────────┐
│ poller.js  │ ────────────────▶ │ osascript /  │  System Events AX role,
│ (per       │ ◀──────────────── │ pgrep        │  Music/Spotify player state
│  detector) │  value or         └──────────────┘
└─────┬──────┘  ProbeError(kind)
      │ onChange (deduplicated)
      ▼
┌────────────┐  snapshot {textFocused, mediaPlaying}   ┌───────────┐
│ engine.js  │ ──────────────────────────────────────▶ │ tick.js   │ → pet-activity.js → state.js → renderer
│            │       (read synchronously every 50 ms)  └───────────┘
│ powerMonitor: suspend/lock pause, resume/unlock restart
└─────┬──────┘
      │ snapshot + pet state + agent sessions (only if tracking is enabled)
      ▼
┌────────────┐  per-day/hour ms   ┌──────────┐  atomic write   ┌──────────────────────────┐
│ recorder   │ ─────────────────▶ │ tracker  │ ──────────────▶ │ userData/activity/        │
└─────┬──────┘                    └──────────┘   every 60 s    │   history.json (+ .bak)   │
      │                                                         └──────────────────────────┘
      ▼
┌────────────────────┐  4 validated invoke channels  ┌──────────────────────────┐
│ insights/controller│ ◀──────────────────────────── │ Insights window (sandbox) │
└────────────────────┘                               └──────────────────────────┘
```

### Why the detectors are polled out-of-band

Before this change, `tick.js` called `execFileSync("osascript", …)` every 400 ms
(text focus) and every 3 s (media) **on the Electron main thread**. Every call
blocked the event loop for the full lifetime of an `osascript` process, which
also stalled the 50 ms animation loop, IPC, and the hook HTTP server. Measured
results are in [benchmarks.md](benchmarks.md).

The engine moves all probing to asynchronous child processes and exposes only
a cached snapshot, so animation code never waits on AppleScript.

### Poller guarantees (`src/activity/poller.js`)

| Concern | Mechanism |
|---|---|
| Overlap | Chained `setTimeout`; the next run is scheduled after the previous settles. The interval is measured from the previous run's start, so cadence matches the old `setInterval`. |
| Hangs | Each run races a deadline timer; on expiry the `AbortSignal` kills the child (`SIGKILL`). |
| Failures | Exponential backoff with ±20 % jitter, capped per detector. |
| Permissions | AppleScript errors -1743 / -1719 / -25211 are classified as `permission-denied` and retried every 30–60 s instead of every 400 ms. |
| Stop / restart | A generation counter invalidates in-flight runs; late results are dropped and no timers survive `stop()`. |
| Duplicates | `onChange` only fires when the value changes. |
| Adaptive polling | `getIntervalMs()` slows polling to 5–10 s when the pet is not observing (mini mode, Do Not Disturb, desktop-pet mode off). |
| Observability | Health per detector: status, runs, failures, timeouts, latency p50/p95. Shown in Insights and in perf samples. |

### Not launching apps by accident

`tell application "Music" to get player state` launches Music if it is closed.
The old code did exactly that (reproduced on macOS 27.0.1). The media detector
now:

1. runs `pgrep -lx "Music|Spotify"` (exit code 1 = nothing running, not an error);
2. sends Apple events only to players that are already running;
3. re-checks `if application "X" is running` inside the script right before `tell`.

### Time accounting (`src/activity/tracker.js`)

One category is active at a time, chosen by priority:

| Priority | Category (UI label) | Source |
|---|---|---|
| — | *(not recorded)* | system suspended or screen locked |
| 1 | sleeping ("Away") | Do Not Disturb |
| 2 | typing | a text-like element is focused **and** there was keyboard/mouse input in the last 2 min |
| 3 | listening | Music or Spotify reports `playing` |
| 4 | agent | an AI coding-agent session is thinking/working (only if agent integration is enabled) |
| 5 | sleeping ("Away") | no keyboard/mouse input for 2 min (`powerMonitor.getSystemIdleTime()`) |
| 6 | idle | otherwise |

"Typing" means *a text field has focus while you are active*; keystrokes and
their contents are never observed — the OS idle timer only reports seconds
since the last input event. (The pet's own sleep timer only watches the mouse,
so it is not used for accounting.)
Segments are split at local hour and day boundaries computed from local time
(DST days have 23/25 hours; on a fall-back day both 1 AM hours share the
hour-1 bucket, while daily totals stay exact). Gaps longer than 2 minutes without an
observation (e.g. a missed suspend event) are dropped, and a backwards clock
jump discards the open segment rather than inventing time.

### Storage (`src/activity/store.js`)

See [privacy.md](privacy.md) for what is stored. Mechanics:

- schema-versioned JSON, `0600`, in `~/Library/Application Support/Desktop Pets/activity/`;
- write: temp file → `fsync` → `rename` → `fsync(dir)`; saves are serialized;
- the last cleanly loaded file is kept as `history.json.bak`;
- a corrupt file is moved to `history.corrupt-<ts>.json` (max 3 kept) and the
  store recovers from the backup, else starts fresh, and the UI says which;
- a file from a newer schema is opened read-only, never downgraded;
- days older than 90 are pruned on load and save.

### Insights window security (`src/insights/controller.js`)

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no `<webview>`;
- dedicated session partition with all permission requests denied;
- `will-navigate` and `window.open` are blocked; strict CSP, no inline script, DOM built
  with `textContent` only;
- four `ipcRenderer.invoke` channels; each handler checks that the sender is the
  window's own `webContents` **and** main frame at the expected `file://` URL, and
  validates argument types;
- System Settings can be opened only for an allowlisted set of panes.

## Agent integration (inherited, now opt-in)

Upstream registered hooks into Claude Code, Cursor, Gemini, CodeBuddy, Kiro and
opencode configuration files on every launch. This fork only does so after the
user enables **Connect AI Coding Agents** in the context menu. The HTTP server
still binds to `127.0.0.1` only.
