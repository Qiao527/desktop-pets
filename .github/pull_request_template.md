## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

- [ ] `npm test` passes
- [ ] New behavior has tests (or explain why not)
- [ ] Real-Mac checks performed are recorded in `docs/verification.md` (if UI, permissions, or lifecycle changed)

## Checklist

- [ ] No synchronous `child_process` calls in `src/`
- [ ] No new data written before the user opts in; privacy docs updated if data handling changed
- [ ] No third-party artwork added to the repository or `build.files`
