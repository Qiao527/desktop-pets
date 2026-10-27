# Privacy and Security

## Summary

- **Activity tracking is off by default.** Nothing is recorded, and no activity
  file or folder is created, until you turn it on (Activity Insights → Tracking).
- **Everything stays on your Mac.** The app makes no network requests for
  activity data. There is no telemetry.
- **Only coarse durations are stored**, never content.
- **You can pause or delete at any time.** Turning tracking off stops sampling
  immediately; *Delete all activity data* removes the history file, its backup,
  and any quarantined copies.

## What the detectors read

| Detector | Reads | Does **not** read |
|---|---|---|
| Text input focus | The accessibility *role* of the focused element in the frontmost app (e.g. `AXTextArea`) | Element value, typed text, selection, window title, app name |
| Media playback | Whether Music or Spotify is running, and its player state (`playing` / `paused`) | Track, artist, playlist, history |
| Input idle time (tracking only) | Seconds since the last keyboard/mouse event, from macOS (`powerMonitor.getSystemIdleTime()`) | Which keys or buttons, or anything typed |

Detector readings are used live to animate the pet even when tracking is off;
they are only written to disk when tracking is on.

## What is stored (tracking on)

`~/Library/Application Support/Desktop Pets/activity/history.json` (mode `0600`):

```json
{
  "schemaVersion": 1,
  "createdAt": 1793000000000,
  "updatedAt": 1793000600000,
  "days": {
    "2026-10-26": {
      "totalsMs": { "typing": 5400000, "listening": 1200000, "agent": 600000, "idle": 900000, "sleeping": 300000 },
      "hourlyMs": { "typing": [0, 0, "… 24 numbers per category …"], "...": [] }
    }
  }
}
```

That is the entire data model: milliseconds per category, per day and hour.
Retention is 90 days; older days are pruned automatically.

## macOS permissions

| Permission | Needed for | If not granted |
|---|---|---|
| Accessibility | Text input focus detector | The detector reports *Needs permission* in Insights and retries every 30 s; the pet never shows "typing". |
| Automation → System Events | Text input focus detector | Same as above. |
| Automation → Music / Spotify | Media detector | Reports *Needs permission*; retries every 60 s. |

When running from source, macOS attributes these permissions to the terminal
that launched the app.

## Other surfaces

- **Agent hooks** (inherited): only written into Claude Code / Cursor / Gemini /
  CodeBuddy / Kiro / opencode config files after you enable *Connect AI Coding
  Agents*. The local HTTP server binds to `127.0.0.1` only.
- **Insights window**: sandboxed renderer, strict CSP, four validated IPC
  channels; see [architecture.md](architecture.md#insights-window-security-srcinsightscontrollerjs).
- **Perf sampler**: only active when `DESKTOP_PETS_PERF_LOG` is set; writes
  event-loop and memory statistics to the given file.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a
public issue.
