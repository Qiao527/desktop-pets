# Security Policy

## Reporting

Please report vulnerabilities privately through GitHub's
**Security → Report a vulnerability** on this repository, not in public issues.

## Threat model (summary)

Desktop Pets runs locally with the user's privileges. It reads coarse activity
signals (see [docs/privacy.md](docs/privacy.md)) and listens on a loopback HTTP
port for AI-agent hooks.

| Surface | Protections |
|---|---|
| Loopback hook server (`127.0.0.1:23333–23337`) | Bound to 127.0.0.1 only. Rejects requests with `Origin` or `Sec-Fetch-Site` headers, non-loopback `Host` (DNS rebinding), and POSTs that are not `application/json` (so browsers cannot send them without a CORS preflight, which is never granted). Body size limits per route. ([`src/local-request-guard.js`](src/local-request-guard.js)) |
| Activity Insights window | Sandboxed, context-isolated, no Node, own session with all permissions denied, navigation/popups blocked, strict CSP, four validated IPC channels, allowlisted Settings links. |
| Activity data | Local only, `0600`, opt-in, durations only, delete-all. |
| Agent config files | Written only after the user enables agent integration; existing hook arrays are appended to, never replaced. |
| AppleScript | Fixed scripts only; no user- or network-supplied input is interpolated. Apple events are sent only to apps that are already running. |
| Packaged build | `scripts/check-package.js` verifies bundled files in CI. |

## Known issues

- **Dependencies.** Since moving to Electron 42.11.18 (which fixes the advisories for
  Electron `<= 42.11.15`), `npm audit` reports no known vulnerabilities in production
  or development dependencies. CI fails on high-severity advisories in production
  dependencies, and Dependabot proposes weekly updates.
- **Inherited windows.** The pet render, hit-test, and permission-bubble windows
  (inherited from upstream) use context isolation but not `sandbox: true`, and some of
  their IPC handlers do not validate the sender. They load only local files.
- **Unauthenticated loopback API.** Any local process running as the same user can
  POST pet state or permission prompts. This is inherent to the hook design. The
  guard above blocks browsers, not local malware.
- **Unsigned builds.** Release builds are not code-signed or notarized.
