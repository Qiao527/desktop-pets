<h1 align="center">Desktop Pets</h1>
<p align="center">A Pochacco desktop pet for macOS that lives on your screen.</p>

An Electron-based desktop pet featuring animated Pochacco stickers. The pet reacts to what you're doing — showing a typing animation when you type, listening when music plays, yawning and falling asleep when you're away, and responding to clicks and drags with playful reactions.

Optionally hooks into AI coding agents (Claude Code, Cursor, Codex, etc.) to reflect their working state in real time.

> macOS only. Requires Node.js 18+.

## Installation

### Prerequisites

You need **Node.js 18 or newer** installed on your Mac. If you don't have it:

```bash
# Option A: Download from https://nodejs.org (LTS recommended)

# Option B: Install via Homebrew
brew install node
```

Verify your installation:

```bash
node --version   # should print v18.x.x or higher
npm --version    # should print 9.x.x or higher
```

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/Qiao527/desktop-pets.git

# 2. Enter the project folder
cd desktop-pets

# 3. Install dependencies (takes ~1 minute the first time)
npm install

# 4. Launch the pet
npm start
```

Pochacco should appear on your desktop within a few seconds. A small icon also appears in the macOS menu bar (top-right area).

### Enable Typing Detection (optional but recommended)

For Pochacco to react when you're typing, macOS needs to allow the app to read which UI element is focused. Without this, typing detection silently does nothing — everything else still works.

1. Open **System Settings**
2. Go to **Privacy & Security → Accessibility**
3. Click the **+** button
4. Add your **terminal app** (e.g. Terminal, iTerm2, Warp) or the Desktop Pets app itself
5. Restart Desktop Pets (`Ctrl+C` in terminal, then `npm start` again)

### Troubleshooting

| Problem | Fix |
|---|---|
| `npm start` shows nothing | Make sure you're in the `desktop-pets` folder. Run `ls package.json` — if it says "No such file", you're in the wrong directory. |
| Pet doesn't appear | Wait a few seconds. If nothing shows up, check the terminal for error messages. |
| "command not found: node" | Node.js isn't installed. See Prerequisites above. |
| Typing animation doesn't work | Grant Accessibility permission (see above). The app needs it to detect text field focus. |
| Menu bar icon missing | Look in the top-right area of your screen. It's a small Pochacco silhouette. Try quitting and restarting. |
| Pet is too big / too small | Right-click the pet → choose a different size (S / M / L). |

### Updating

```bash
cd desktop-pets
git pull
npm install   # only needed if dependencies changed
npm start
```

## How to Use

**Right-click** the pet to access the menu:
- **Size** — Small / Medium / Large
- **Do Not Disturb** — puts Pochacco to sleep, ignores all events
- **Sound** — toggle sound effects on/off
- **Check for Updates** — pull latest changes

**Single click** — Pochacco does a reaction animation

**Double click** — poke reaction (left or right, depending on where you click)

**4 rapid clicks** — annoyed multi-reaction

**Drag** — move Pochacco anywhere on your screen. After releasing, a landing animation plays.

## What Pochacco Does

| What's happening | What Pochacco does |
|---|---|
| You're just working | Hangs out idle, occasionally looks around |
| You type in a text field | Shows typing animation |
| Apple Music or Spotify playing | Listens along |
| 45 seconds of no mouse movement | Looks around curiously |
| 2 minutes of no activity | Yawns, then falls asleep |
| You move the mouse after sleep | Startled wake-up animation |
| You click Pochacco | Playful reaction |
| You drag and drop Pochacco | Landing animation after release |

### AI Agent Integration (optional)

If you use AI coding tools, Desktop Pets can hook into them to show what your agent is doing:

- **Claude Code** — thinking, working, error, task complete (auto-registered on launch)
- **Cursor Agent** — hooks via `~/.cursor/hooks.json` (auto-registered on launch)
- **Codex CLI** — automatic log polling, no setup needed
- **Gemini CLI**, **Copilot CLI**, **Kiro CLI**, **opencode** — various levels of support

When no agent is running, the pet operates purely as a desktop companion.

## Sticker Reference

| Situation | File | Duration |
|---|---|---|
| Default idle | `idle-follow.webp` | Continuous |
| Alternate idle | `idle2.webp` | Shuffles every 5-8 min |
| Looking around | `pet-idle-look.webp` | 8s after 45s idle |
| Typing | `pet-typing.webp` | While text field focused |
| Listening to music | `listening.webp` | While music plays |
| Yawning | `yawning.webp` | 3s before sleep |
| Sleeping | `pet-sleeping.webp` | Until mouse moves |
| Waking up | `pet-waking.webp` | 1.5s |
| Click reaction | `reaction-click.webp` | 2s |
| Multi-click reaction | `reaction-multi.webp` | 2.5-2.8s |
| Drag landing | `reaction-drag-land.webp` | 2s (after 500ms delay) |
| AI thinking | `thinking.webp` | While prompting |
| AI working | `working.webp` | While tools run |

## Customization

The Pochacco theme lives in `themes/pochacco-test/`. You can swap any `.webp` sticker by replacing the file (keep the same filename) and restarting.

To create a completely new theme, make a folder in:

```
~/Library/Application Support/desktop-pets/themes/my-theme/
```

Add a `theme.json` (copy from `themes/pochacco-test/theme.json` as a starting point) and your sticker files.

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
