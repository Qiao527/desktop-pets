# macOS Verification

Automated tests run on macOS and Linux in CI, but they use fake clocks, fake
`execFile`, and fake windows. The checks below need a real Mac. Each entry
records whether it has been performed and on what hardware.

Hardware used: Apple M1, macOS 27.0.1, Node 25.8.2 / Electron 41.

## Performed

| # | Check | How | Result |
|---|---|---|---|
| V1 | Legacy code launches Music | Quit Music, start the pre-engine build (`30d52cc`) | **Reproduced**: Music started 8 s after launch |
| V2 | Event-loop responsiveness, legacy vs async | `perf/activity-detectors/run-app.sh`, alternating 5-minute runs | See [benchmarks.md](benchmarks.md) |
| V3 | Text-focus detector works with Accessibility granted | Detector health in perf samples | `ok`, 0 failures before the lock; p50 220–282 ms per probe |
| V4 | Media detector with Music + Spotify running | Detector health in perf samples | `ok`, 0 failures; p50 209–240 ms |
| V5 | Startup / shutdown stability | `run-app.sh` times server start and SIGTERM exit; checks `~/.clawd/runtime.json` is removed | All runs exited cleanly in ≤ 1 s, runtime file removed |
| V6 | Pip renders through the real renderer | Offscreen capture of `src/index.html` for 9 states | All states render (see `docs/media/pip-states.png`) |
| V7 | Local-only Pochacco theme loads from userData | Same capture harness with `~/Library/Application Support/Desktop Pets/themes/pochacco-test` | Renders as a user theme |
| V8 | Launching does not modify agent configs when integration is off | Compare `~/.claude/settings.json` before/after launch | Unchanged |
| V9 | Engine pauses on screen lock | macOS auto-locked during benchmark run async-r3 | Both detectors reported `stopped` after the lock event (see benchmarks.md) |
| V10 | Insights opens without creating data when tracking was never enabled | Real controller + sandboxed window against an empty temp store | No files created |
| V11 | Insights renders in light and dark mode | Real window capture with `nativeTheme.themeSource` | See `docs/media/insights-*.png` (synthetic data) |
| V12 | App with Insights wiring starts and quits cleanly; tracking off creates no `activity/` folder | `run-app.sh` 25 s smoke run | Exit 0.5 s after SIGTERM; no folder created |

## Still to perform by hand

These need interaction or OS state changes that were not automated:

| # | Check | Steps | Expected |
|---|---|---|---|
| M1 | Typing reaction | Click into a text field in any app | Pet switches to typing within ~0.5 s; back to idle when focus leaves |
| M2 | Listening reaction, no launch side effect | Quit Music; play in Spotify | Pet shows listening; Music does **not** open |
| M3 | Permission denied path | Remove the terminal from Accessibility, restart | Insights → Detector health shows *Needs permission*; button opens the Accessibility pane |
| M4 | Sleep / wake (system sleep, not just lock) | Enable tracking, sleep the Mac 2+ min, wake | Insights totals do not include the sleep period; detectors resume |
| M5 | Lock / unlock | Lock screen (⌃⌘Q) for 1 min, unlock | Same as M4 |
| M6 | Midnight | Leave tracking on across midnight (or set the clock) | Time split between both days |
| M7 | Tracking opt-in | Fresh userData, open Insights | Empty state; no `activity/` folder exists until *Turn on tracking* |
| M8 | Delete | Insights → Delete all → Delete | `activity/` folder is empty; summaries reset |
| M9 | Corruption recovery | Quit, write garbage into `activity/history.json`, relaunch, open Insights | Banner says restored from backup; a `history.corrupt-*.json` file exists |
| M10 | Dark / light mode | Toggle macOS appearance with Insights open | Colors follow the system |
| M11 | Keyboard | Tab through Insights; Space toggles tracking; Escape cancels delete | All controls reachable with visible focus |
| M12 | Multiple displays / scaling | Drag the pet between displays with different scaling | Pet stays visible and clamped (inherited behavior) |
| M13 | Packaged build | `npm run build:mac`, open the DMG app | Pip theme, Pip tray icon, no Clawd/Calico themes listed |

## Reproducing the benchmark

```bash
# legacy build in a worktree
git worktree add ../dp-legacy 30d52cc && ln -s "$PWD/node_modules" ../dp-legacy/node_modules
OUT=perf/activity-detectors/results/$(date +%F)-mine
perf/activity-detectors/run-app.sh ../dp-legacy legacy-sync-r1 300 "$OUT"
perf/activity-detectors/run-app.sh "$PWD"     async-engine-r1 300 "$OUT"
node perf/activity-detectors/summarize.js "$OUT"/*.jsonl --md
```

`run-app.sh` backs up and restores your prefs file. Keep other workloads
quiet while it runs, and note which media players are open (the legacy build
will launch Music if it is closed).
