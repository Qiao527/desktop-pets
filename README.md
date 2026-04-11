<h1 align="center">Desktop Pets</h1>
<p align="center">A Pochacco desktop pet for macOS that lives on your screen.</p>

An Electron-based desktop pet featuring animated Pochacco stickers. The pet reacts to what you're doing — showing a typing animation when you type, listening when music plays, yawning and falling asleep when you're away, and responding to clicks and drags with playful reactions.

Optionally hooks into AI coding agents (Claude Code, Cursor, Codex, etc.) to reflect their working state in real time.

> macOS only. Requires Node.js 18+.

## What it does

- **Idle** — Pochacco hangs out on your desktop, occasionally looking around
- **Typing** — detects when you're focused on a text field and shows a typing animation
- **Listening** — detects Apple Music or Spotify playback and bobs along
- **Sleep sequence** — after 2 minutes of inactivity: yawning, dozing, then deep sleep
- **Click reactions** — single click, double click, and rapid 4-click each trigger different animations
- **Drag & drop** — drag Pochacco anywhere on screen; landing animation plays after you drop
- **Do Not Disturb** — right-click to put the pet to sleep manually
- **Menu bar icon** — quick access to settings via the macOS menu bar

### AI Agent Integration (optional)

If you use AI coding tools, Desktop Pets can hook into them to show what your agent is doing:

- **Claude Code** — thinking, working, error, task complete
- **Cursor Agent** — hooks via `~/.cursor/hooks.json`
- **Codex CLI** — automatic log polling
- **Gemini CLI**, **Copilot CLI**, **Kiro CLI**, **opencode** — various levels of support

When no agent is running, the pet operates purely as a desktop companion.

## Quick Start

```bash
git clone https://github.com/Qiao527/desktop-pets.git
cd desktop-pets
npm install
npm start
```

The pet appears on your desktop immediately. Right-click for options.

### Accessibility Permission

For typing detection to work, grant Accessibility access to your terminal (or the Desktop Pets app) in:

**System Settings → Privacy & Security → Accessibility**

Without this, the pet won't react to your typing — everything else still works.

## Sticker Mapping

| Situation | Animation | Timing |
|---|---|---|
| Default | `idle-follow.webp` | Always |
| Alternate idle | `idle2.webp` | Random shuffle every 5-8 min |
| Mouse idle 45s | `pet-idle-look.webp` | Plays 8s, then returns |
| Typing in text field | `pet-typing.webp` | While focused (polls every 400ms) |
| Music playing | `listening.webp` | While Apple Music / Spotify active |
| Inactivity 2 min | `yawning.webp` | 3s, then dozing |
| Dozing / sleeping | `pet-sleeping.webp` | Until mouse moves |
| Mouse moves (from sleep) | `pet-waking.webp` | 1.5s wake animation |
| Single click | `reaction-click.webp` | 2s |
| Double click | `reaction-click.webp` or `reaction-multi.webp` | 2-2.5s |
| 4x rapid click | `reaction-multi.webp` | 2.8s |
| After drag release | `reaction-drag-land.webp` | 500ms delay, then 2s |
| AI agent thinking | `thinking.webp` | While prompting |
| AI agent working | `working.webp` | While tools run |
| AI task complete | `reaction-drag-land.webp` | Celebration |
| AI notification | `reaction-drag-land.webp` | Alert |

## Customization

The Pochacco theme lives in `themes/pochacco-test/`. You can swap any `.webp` sticker by replacing the files and updating `theme.json`.

The app supports custom themes — create a new folder in your themes directory with a `theme.json` and your own animated stickers (WebP, GIF, APNG, or SVG):

- macOS: `~/Library/Application Support/desktop-pets/themes/my-theme/`

## Project Structure

```
src/
  main.js          — Electron main process, window management
  renderer.js      — Animation display, image swapping
  hit-renderer.js  — Click/drag input handling
  tick.js          — Idle timer, typing/music detection, sleep sequence
  state.js         — State machine (multi-session priority)
  menu.js          — Right-click menu, tray icon
  server.js        — HTTP server for agent hooks (port 23333)
themes/
  pochacco-test/   — Pochacco sticker theme
hooks/
  clawd-hook.js    — Claude Code event hook
  cursor-hook.js   — Cursor Agent event hook
```

## Based on

Forked from [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) by [@rullerzhou-afk](https://github.com/rullerzhou-afk). Original project supports multiple themes and platforms. This fork is a personal macOS build with Pochacco stickers and streamlined for desktop companion use.

## License

Source code: [MIT License](LICENSE)

Pochacco character is the property of Sanrio. This is an unofficial fan project for personal use, not affiliated with or endorsed by Sanrio.
