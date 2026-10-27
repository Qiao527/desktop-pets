# Changelog

All notable changes in this fork. Versions before 0.6.0 are upstream
[clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) releases plus
the fork's initial Pochacco customization.

## 0.6.0 — Activity Intelligence (unreleased)

### Added
- Asynchronous macOS activity engine (`src/activity/`): text-focus and media
  detectors with hard timeouts, cancellation, non-overlapping polling,
  exponential backoff, permission-error classification, and suspend/lock pausing.
- Opt-in activity tracking with per-day/per-hour accounting that handles
  midnight/DST boundaries, missed sleep events, and clock skew.
- Versioned local store with atomic writes, last-good backup, corruption
  quarantine, newer-schema read-only mode, 90-day retention, and delete-all.
- Activity Insights window: today, by-hour and 7-day summaries, detector
  health with permission help, privacy controls. Sandboxed with validated IPC.
- Original default theme **Pip** with generated artwork, icons and sounds.
- Opt-in main-process perf sampler (`DESKTOP_PETS_PERF_LOG`) and a reproducible
  benchmark (`perf/activity-detectors/`).
- Test workflow on push and pull request (macOS + Ubuntu, Node 24).

### Changed
- AI agent hooks are only written into other tools' configs after the user
  enables *Connect AI Coding Agents*.
- Packaged builds contain only redistributable artwork.

### Fixed
- Opt-in tracking did not resume after restarting the app.
- Main thread blocked by synchronous `osascript` calls every 400 ms.
- Checking playback launched Apple Music when it was closed.
- Missing Accessibility permission was indistinguishable from "not typing".
- `LICENSE` restored upstream's copyright notice.
- Kiro installer test was not hermetic on machines with `kiro-cli` installed.
- Local hook server accepted browser and DNS-rebinding requests.

### Removed
- Pochacco artwork (Sanrio character) from the repository; it can be installed
  as a local user theme.
