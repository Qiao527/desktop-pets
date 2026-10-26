# CLAUDE.md

Guidance for AI coding assistants (and humans) working in this repository.

## Project

Desktop Pets — a macOS-focused Electron desktop pet, forked from
[clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk). The fork adds the
Activity Intelligence subsystem (`src/activity/`, `src/insights/`). Read
[docs/architecture.md](docs/architecture.md) before changing anything non-trivial and
[NOTICE.md](NOTICE.md) for what is inherited.

## Commands

```bash
npm ci                 # install
npm start              # run from source
npm test               # all tests (node --test test/*.test.js)
npm run build:mac      # unsigned DMG (arm64 + x64)
node tools/pip-theme/build.js --icons   # regenerate Pip artwork, icons, sounds
node scripts/validate-theme.js themes/pip
DESKTOP_PETS_PERF_LOG=/tmp/perf.jsonl npm start   # perf sampler
```

Manual state test: `curl -X POST http://127.0.0.1:23333/state -H 'Content-Type: application/json' -d '{"state":"working"}'`.

## Rules

- **Never block the Electron main thread.** No `execFileSync` / `execSync` / `spawnSync`
  in `src/` (enforced by `test/activity-detectors.test.js`). New detectors go through
  `createPoller()` with a timeout.
- **Never launch other apps as a side effect.** Only send Apple events to processes
  that are already running, and re-check `is running` inside the script.
- **Privacy:** activity tracking is opt-in; store only per-category durations. Never
  read element values, text, titles, or app names. Nothing may be written under
  `userData/activity/` before the user enables tracking.
- **Agent hooks are opt-in** (`agentSessionReactive`). When registering hooks, append to
  existing hook arrays — never overwrite another tool's config.
- **Artwork:** only `themes/pip/` and generated icons/sounds are bundled. Do not add
  third-party character art to the repository or to `build.files`.
- **IPC:** new privileged channels must validate the sender (see
  `isTrustedSender` in `src/insights/controller.js`) and argument types.
- **Mini mode:** every window-positioning path must respect `miniTransitioning`, or
  concurrent `setPosition()` calls can crash.
- Do not call `win.setAlwaysOnTop(false)` on the pet window: it is transparent,
  unfocusable, and skips the taskbar, so it would vanish behind the desktop.
- The Language submenu bottom-edge clipping on Windows is a known Electron/DWM issue;
  do not spend time on it.
- Use `path.join(__dirname, …)` for resources so packaged builds resolve paths.
- Keep secrets in `.env`; never hard-code them.

## Testing expectations

Add tests next to the area you change (`test/activity-*.test.js`, `test/insights-*.test.js`,
etc.). Scheduler and time-accounting code takes injectable clocks — use
`test/helpers/fake-clock.js` instead of real timers. GUI and macOS permission behavior
must be verified by hand; record results in [docs/verification.md](docs/verification.md).
