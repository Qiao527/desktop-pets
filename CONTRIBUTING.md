# Contributing

Thanks for your interest! This is a small, macOS-focused project, so the process is light.

## Setup

```bash
nvm use            # Node 24 (see .nvmrc); Node 22 also works
npm ci
npm start          # run the app from source
npm test           # unit + integration tests
npm run test:coverage
```

## Before opening a pull request

1. Keep changes small and focused; one concern per PR.
2. Add or update tests next to the code you change (`test/`). Scheduler and
   time-accounting code takes injectable clocks — use `test/helpers/fake-clock.js`.
3. If you touched UI, macOS permissions, sleep/wake, or app lifecycle, perform
   the relevant manual checks in [docs/verification.md](docs/verification.md)
   and note the results in the PR.
4. Read the rules in [CLAUDE.md](CLAUDE.md) (they apply to humans too):
   never block the main thread, never launch other apps, keep tracking opt-in,
   and never add third-party character artwork.

## Commit messages

Conventional style, imperative mood: `fix(activity): resume tracking after restart`.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please do not open public issues for vulnerabilities.
