// src/tick.js — Main tick loop (cursor polling, eye tracking, idle/sleep detection, mini peek)
// Extracted from main.js L527-689

const { screen } = require("electron");
const { isFrontmostTextFieldFocusedSync } = require("./mac-text-field-focused");
const { isMacMediaPlayingSync } = require("./mac-media-playing");

module.exports = function initTick(ctx) {

// ── Mouse idle tracking ──
let lastCursorX = null, lastCursorY = null;
let mouseStillSince = Date.now();
let isMouseIdle = false;       // showing idle-look
let hasTriggeredYawn = false;  // 60s threshold already fired
let idleLookPlayed = false;    // idle-look already played once since last movement
let idleLookReturnTimer = null;
let yawnDelayTimer = null;     // tracked setTimeout for yawn/idle-look transitions
let idleWasActive = false;
let idle2ShuffleTimer = null;
let lastIdleBaseState = "idle";
let lastIdleBaseSvg = null;
let beforeTypingVariant = "idle";
let lastEyeDx = 0, lastEyeDy = 0;
let mainTickTimer = null;
let typingPollTimer = null;
let typingFocusCached = false;
let mediaPollTimer = null;
let mediaPlayingCached = false;

// ── Theme-driven state (refreshed on hot theme switch) ──
let theme = null;
let MOUSE_IDLE_TIMEOUT = 0;
let MOUSE_SLEEP_TIMEOUT = 0;
let SVG_IDLE_FOLLOW = null;
let IDLE_ANIMS = [];
let IDLE2_FILE = null;
let TYPING_FILE = null;
let LISTENING_FILE = null;
let HOVER_FILES = [];
let _hoverDisabled = false;

function refreshTheme() {
  theme = ctx.theme;
  MOUSE_IDLE_TIMEOUT = theme.timings.mouseIdleTimeout;
  MOUSE_SLEEP_TIMEOUT = theme.timings.mouseSleepTimeout;
  SVG_IDLE_FOLLOW = theme.states.idle[0];
  IDLE_ANIMS = (theme.idleAnimations || []).map(a => ({ svg: a.file, duration: a.duration }));
  IDLE2_FILE = (theme.states.idle2 && theme.states.idle2[0]) || SVG_IDLE_FOLLOW;
  TYPING_FILE = (theme.states.typing && theme.states.typing[0]) || SVG_IDLE_FOLLOW;
  LISTENING_FILE = (theme.states.listening && theme.states.listening[0]) || SVG_IDLE_FOLLOW;
  HOVER_FILES = (theme.states.hover && theme.states.hover.length)
    ? theme.states.hover
    : theme.states.idle;
  // If hover uses the same file as idle, disable hover entirely to avoid animation resets
  _hoverDisabled = HOVER_FILES.length === 1 && HOVER_FILES[0] === SVG_IDLE_FOLLOW;
  lastIdleBaseSvg = SVG_IDLE_FOLLOW;
}

refreshTheme();

// ── Unified main tick (cursor polling for eye tracking + sleep + mini peek) ──
// Input routing is handled by hitWin — no setIgnoreMouseEvents toggling here.
function startMainTick() {
  if (mainTickTimer) return;
  // Render window: permanently click-through (set once, never toggle)
  ctx.win.setIgnoreMouseEvents(true);
  ctx.mouseOverPet = false;

  mainTickTimer = setInterval(() => {
    if (!ctx.win || ctx.win.isDestroyed()) return;

    // ── Idle state edge detection (must run every tick for timer cleanup) ──
    const idleNow = (ctx.currentState === "idle" || ctx.currentState === "idle2" || ctx.currentState === "typing" || ctx.currentState === "listening") && !ctx.idlePaused;
    const miniIdleNow = ctx.currentState === "mini-idle" && !ctx.idlePaused && !ctx.miniTransitioning;

    if (idleNow && !idleWasActive) {
      isMouseIdle = false;
      hasTriggeredYawn = false;
      idleLookPlayed = false;
      lastCursorX = null;
      lastCursorY = null;
      mouseStillSince = Date.now();
      lastEyeDx = 0;
      lastEyeDy = 0;
      if (idleLookReturnTimer) { clearTimeout(idleLookReturnTimer); idleLookReturnTimer = null; }
      if (yawnDelayTimer) { clearTimeout(yawnDelayTimer); yawnDelayTimer = null; }
      if (idle2ShuffleTimer) { clearTimeout(idle2ShuffleTimer); idle2ShuffleTimer = null; }
    }

    if (!idleNow && idleWasActive) {
      if (idleLookReturnTimer) { clearTimeout(idleLookReturnTimer); idleLookReturnTimer = null; }
      if (yawnDelayTimer) { clearTimeout(yawnDelayTimer); yawnDelayTimer = null; }
      if (idle2ShuffleTimer) { clearTimeout(idle2ShuffleTimer); idle2ShuffleTimer = null; }
    }
    idleWasActive = idleNow;

    // Skip expensive native IPC calls (getCursorScreenPoint, getBounds) when
    // cursor tracking is not needed — saves ~20 calls/sec to the OS layer.
    const needsCursorPoll = idleNow || miniIdleNow || ctx.miniMode
      || (ctx.desktopPetMode && ctx.currentState === "hover");
    if (!needsCursorPoll) return;

    const cursor = screen.getCursorScreenPoint();

    // ── Cursor-over-pet tracking (for mini peek + eye tracking, NOT for input routing) ──
    const bounds = ctx.win.getBounds();
    if (!ctx.dragLocked) {
      const hit = ctx.getHitRectScreen(bounds);
      const over = cursor.x >= hit.left && cursor.x <= hit.right
                && cursor.y >= hit.top  && cursor.y <= hit.bottom;
      ctx.mouseOverPet = over;
    }

    // ── Desktop pet: hover state (non-mini) ──
    if (ctx.desktopPetMode && !_hoverDisabled && !ctx.miniMode && !ctx.miniTransitioning && !ctx.dragLocked && !ctx.menuOpen) {
      const canHover = ctx.currentState === "idle" || ctx.currentState === "idle2" || ctx.currentState === "typing" || ctx.currentState === "listening" || ctx.currentState === "hover";
      if (canHover) {
        if (ctx.mouseOverPet && ctx.currentState !== "hover") {
          lastIdleBaseState = ctx.currentState;
          if (ctx.currentState === "idle2") lastIdleBaseSvg = ctx.currentSvg || IDLE2_FILE;
          else if (ctx.currentState === "typing") lastIdleBaseSvg = ctx.currentSvg || TYPING_FILE;
          else if (ctx.currentState === "listening") lastIdleBaseSvg = ctx.currentSvg || LISTENING_FILE;
          else lastIdleBaseSvg = ctx.currentSvg || SVG_IDLE_FOLLOW;
          const pick = HOVER_FILES[Math.floor(Math.random() * HOVER_FILES.length)];
          ctx.applyState("hover", pick);
        } else if (!ctx.mouseOverPet && ctx.currentState === "hover") {
          const backState = lastIdleBaseState === "idle2" ? "idle2"
            : lastIdleBaseState === "typing" ? "typing"
            : lastIdleBaseState === "listening" ? "listening"
            : "idle";
          const backSvg = lastIdleBaseSvg
            || (backState === "idle2" ? IDLE2_FILE
              : backState === "typing" ? TYPING_FILE
              : backState === "listening" ? LISTENING_FILE
              : SVG_IDLE_FOLLOW);
          ctx.applyState(backState, backSvg);
        }
      }
    }

    // Desktop pet: macOS text field focused → typing. Typing wins over listening.
    if (ctx.desktopPetMode && !ctx.miniMode && !ctx.miniTransitioning && !ctx.doNotDisturb && !ctx.menuOpen
        && process.platform === "darwin") {
      if (typingFocusCached && (ctx.currentState === "idle" || ctx.currentState === "idle2" || ctx.currentState === "listening")) {
        if (idle2ShuffleTimer) { clearTimeout(idle2ShuffleTimer); idle2ShuffleTimer = null; }
        if (ctx.currentState === "listening") beforeTypingVariant = "listening";
        else beforeTypingVariant = ctx.currentState === "idle2" ? "idle2" : "idle";
        ctx.applyState("typing", TYPING_FILE);
      } else if (!typingFocusCached && ctx.currentState === "typing") {
        if (beforeTypingVariant === "listening" && mediaPlayingCached) {
          ctx.applyState("listening", LISTENING_FILE);
          lastIdleBaseState = "listening";
          lastIdleBaseSvg = LISTENING_FILE;
        } else if (beforeTypingVariant === "idle2") {
          ctx.applyState("idle2", IDLE2_FILE);
          lastIdleBaseState = "idle2";
          lastIdleBaseSvg = IDLE2_FILE;
        } else {
          ctx.applyState("idle", SVG_IDLE_FOLLOW);
          lastIdleBaseState = "idle";
          lastIdleBaseSvg = SVG_IDLE_FOLLOW;
        }
      }
    }

    // Desktop pet: Music / Spotify playing → listening (after typing)
    if (ctx.desktopPetMode && !ctx.miniMode && !ctx.miniTransitioning && !ctx.doNotDisturb && !ctx.menuOpen
        && process.platform === "darwin" && !typingFocusCached) {
      if (mediaPlayingCached && (ctx.currentState === "idle" || ctx.currentState === "idle2")) {
        if (idle2ShuffleTimer) { clearTimeout(idle2ShuffleTimer); idle2ShuffleTimer = null; }
        ctx.applyState("listening", LISTENING_FILE);
      } else if (!mediaPlayingCached && ctx.currentState === "listening") {
        ctx.applyState("idle", SVG_IDLE_FOLLOW);
        lastIdleBaseState = "idle";
        lastIdleBaseSvg = SVG_IDLE_FOLLOW;
      }
    }

    // ── Mini mode peek hover ──
    if (ctx.miniMode && !ctx.miniTransitioning && !ctx.dragLocked && !ctx.menuOpen) {
      const canPeek = ctx.currentState === "mini-idle" || ctx.currentState === "mini-peek"
        || ctx.currentState === "mini-sleep";
      if (!ctx.isAnimating && canPeek) {
        if (ctx.mouseOverPet && ctx.currentState === "mini-sleep" && !ctx.miniSleepPeeked) {
          ctx.miniPeekIn();
          ctx.miniSleepPeeked = true;
        } else if (!ctx.mouseOverPet && ctx.currentState === "mini-sleep" && ctx.miniSleepPeeked) {
          ctx.miniPeekOut();
          ctx.miniSleepPeeked = false;
        } else if (ctx.mouseOverPet && ctx.currentState !== "mini-peek" && ctx.currentState !== "mini-sleep" && !ctx.miniPeeked) {
          ctx.miniPeekIn();
          ctx.applyState("mini-peek");
        } else if (!ctx.mouseOverPet && (ctx.currentState === "mini-peek" || ctx.miniPeeked)) {
          ctx.miniPeekOut();
          ctx.miniPeeked = false;
          if (ctx.currentState !== "mini-idle") ctx.applyState("mini-idle");
        }
      }
    }

    if (!idleNow && !miniIdleNow && !(ctx.desktopPetMode && ctx.currentState === "hover")) return;

    // ── Below: idle or mini-idle logic ──
    const moved = lastCursorX !== null && (cursor.x !== lastCursorX || cursor.y !== lastCursorY);
    lastCursorX = cursor.x;
    lastCursorY = cursor.y;

    // Normal idle: mouse idle detection + sleep sequence
    if (idleNow) {
      if (moved) {
        mouseStillSince = Date.now();
        hasTriggeredYawn = false;
        idleLookPlayed = false;
        if (idleLookReturnTimer) { clearTimeout(idleLookReturnTimer); idleLookReturnTimer = null; }
        if (yawnDelayTimer) { clearTimeout(yawnDelayTimer); yawnDelayTimer = null; }
        if (isMouseIdle) {
          isMouseIdle = false;
          const baseSvg = ctx.currentState === "idle2" ? IDLE2_FILE
            : ctx.currentState === "typing" ? TYPING_FILE
            : ctx.currentState === "listening" ? LISTENING_FILE
            : SVG_IDLE_FOLLOW;
          ctx.sendToRenderer("state-change", ctx.currentState, baseSvg);
        }
      }

      const elapsed = Date.now() - mouseStillSince;

      // Startup recovery: Claude Code is running but no hook yet — stay awake
      // Only suppress sleep sequence, don't skip eye tracking below
      if (ctx.startupRecoveryActive) {
        mouseStillSince = Date.now();
      }

      // Desktop pet: shuffle between idle and idle2 while truly idle (no agent sessions)
      if (ctx.desktopPetMode && (!ctx.sessions || ctx.sessions.size === 0) && !ctx.mouseOverPet
          && !typingFocusCached && !mediaPlayingCached
          && (ctx.currentState === "idle" || ctx.currentState === "idle2")) {
        if (!idle2ShuffleTimer) {
          // 5–8 min between idle ↔ idle2 shuffle (desktop pet mode, no sessions)
          const delay = 300_000 + Math.floor(Math.random() * 180_000);
          idle2ShuffleTimer = setTimeout(() => {
            idle2ShuffleTimer = null;
            if (typingFocusCached || mediaPlayingCached) return;
            if (ctx.currentState !== "idle" && ctx.currentState !== "idle2") return;
            if (ctx.mouseOverPet) return;
            if (ctx.sessions && ctx.sessions.size > 0) return;
            if (ctx.currentState === "idle") {
              ctx.applyState("idle2", IDLE2_FILE);
              lastIdleBaseState = "idle2";
              lastIdleBaseSvg = IDLE2_FILE;
            } else {
              ctx.applyState("idle", SVG_IDLE_FOLLOW);
              lastIdleBaseState = "idle";
              lastIdleBaseSvg = SVG_IDLE_FOLLOW;
            }
          }, delay);
        }
      }

      // 60s no mouse movement → yawning → dozing
      if (!hasTriggeredYawn && elapsed >= MOUSE_SLEEP_TIMEOUT) {
        hasTriggeredYawn = true;
        if (!isMouseIdle) ctx.sendToRenderer("eye-move", 0, 0);
        yawnDelayTimer = setTimeout(() => {
          yawnDelayTimer = null;
          if (ctx.currentState === "idle" || ctx.currentState === "idle2" || ctx.currentState === "typing" || ctx.currentState === "listening") ctx.setState("yawning");
        }, isMouseIdle ? 50 : 250);
        return;
      }

      // 20s no mouse movement → random idle animation (play once, then return to idle-follow)
      if (IDLE_ANIMS.length > 0 && !isMouseIdle && !hasTriggeredYawn && !idleLookPlayed && elapsed >= MOUSE_IDLE_TIMEOUT) {
        isMouseIdle = true;
        idleLookPlayed = true;
        const pick = IDLE_ANIMS[Math.floor(Math.random() * IDLE_ANIMS.length)];
        ctx.sendToRenderer("eye-move", 0, 0);
        setTimeout(() => {
          if (isMouseIdle && (ctx.currentState === "idle" || ctx.currentState === "idle2" || ctx.currentState === "typing" || ctx.currentState === "listening")) {
            ctx.sendToRenderer("state-change", ctx.currentState, pick.svg);
            ctx.sendToHitWin("hit-state-sync", { currentSvg: pick.svg });
          }
        }, 250);
        idleLookReturnTimer = setTimeout(() => {
          idleLookReturnTimer = null;
          if (isMouseIdle && (ctx.currentState === "idle" || ctx.currentState === "idle2" || ctx.currentState === "typing" || ctx.currentState === "listening")) {
            isMouseIdle = false;
            const back = ctx.currentState === "idle2" ? IDLE2_FILE
              : ctx.currentState === "typing" ? TYPING_FILE
              : ctx.currentState === "listening" ? LISTENING_FILE
              : SVG_IDLE_FOLLOW;
            ctx.sendToRenderer("state-change", ctx.currentState, back);
            ctx.sendToHitWin("hit-state-sync", { currentSvg: back });
            setTimeout(() => { ctx.forceEyeResend = true; }, 200);
          }
        }, 250 + pick.duration);
        return;
      }
    }

    const baseIdleSvg = ctx.currentState === "idle2" ? IDLE2_FILE
      : ctx.currentState === "typing" ? TYPING_FILE
      : ctx.currentState === "listening" ? LISTENING_FILE
      : SVG_IDLE_FOLLOW;
    const trackEyesNow = (idleNow && ctx.currentSvg === baseIdleSvg && !isMouseIdle) || miniIdleNow;
    if (!trackEyesNow) return;
    if (ctx.eyePauseUntil) {
      if (Date.now() < ctx.eyePauseUntil) return;
      ctx.eyePauseUntil = null;
    }
    if (!moved && !ctx.forceEyeResend) return;

    // ── Eye position calculation (shared by idle and mini-idle) ──
    const skipDedup = ctx.forceEyeResend;
    ctx.forceEyeResend = false;

    const obj = ctx.getObjRect(bounds);
    const eyeScreenX = obj.x + obj.w * theme.eyeTracking.eyeRatioX;
    const eyeScreenY = obj.y + obj.h * theme.eyeTracking.eyeRatioY;

    const relX = cursor.x - eyeScreenX;
    const relY = cursor.y - eyeScreenY;

    const MAX_OFFSET = theme.eyeTracking.maxOffset;
    const dist = Math.sqrt(relX * relX + relY * relY);
    let eyeDx = 0, eyeDy = 0;
    if (dist > 1) {
      const scale = Math.min(1, dist / 300);
      eyeDx = (relX / dist) * MAX_OFFSET * scale;
      eyeDy = (relY / dist) * MAX_OFFSET * scale;
    }

    eyeDx = Math.round(eyeDx * 2) / 2;
    eyeDy = Math.round(eyeDy * 2) / 2;
    const yClamp = MAX_OFFSET * 0.5;
    eyeDy = Math.max(-yClamp, Math.min(yClamp, eyeDy));

    if (skipDedup || eyeDx !== lastEyeDx || eyeDy !== lastEyeDy) {
      lastEyeDx = eyeDx;
      lastEyeDy = eyeDy;
      ctx.sendToRenderer("eye-move", eyeDx, eyeDy);
    }
  }, 50); // ~20fps — hit-test needs faster response than 67ms eye tracking

  if (process.platform === "darwin") {
    try { typingFocusCached = isFrontmostTextFieldFocusedSync(); } catch { typingFocusCached = false; }
    typingPollTimer = setInterval(() => {
      try { typingFocusCached = isFrontmostTextFieldFocusedSync(); } catch { typingFocusCached = false; }
    }, 400);
    try { mediaPlayingCached = isMacMediaPlayingSync(); } catch { mediaPlayingCached = false; }
    mediaPollTimer = setInterval(() => {
      try { mediaPlayingCached = isMacMediaPlayingSync(); } catch { mediaPlayingCached = false; }
    }, 3000);
  }
}

function resetIdleTimer() {
  mouseStillSince = Date.now();
}

function cleanup() {
  if (mainTickTimer) { clearInterval(mainTickTimer); mainTickTimer = null; }
  if (typingPollTimer) { clearInterval(typingPollTimer); typingPollTimer = null; }
  if (mediaPollTimer) { clearInterval(mediaPollTimer); mediaPollTimer = null; }
  if (idleLookReturnTimer) { clearTimeout(idleLookReturnTimer); idleLookReturnTimer = null; }
  if (yawnDelayTimer) { clearTimeout(yawnDelayTimer); yawnDelayTimer = null; }
  if (idle2ShuffleTimer) { clearTimeout(idle2ShuffleTimer); idle2ShuffleTimer = null; }
  lastCursorX = null;
  lastCursorY = null;
  isMouseIdle = false;
  hasTriggeredYawn = false;
  idleLookPlayed = false;
  idleWasActive = false;
  lastEyeDx = 0;
  lastEyeDy = 0;
}

// Expose mouseStillSince for wake poll (state.js deep sleep timeout)
Object.defineProperty(startMainTick, '_mouseStillSince', {
  get() { return mouseStillSince; },
});

return { startMainTick, resetIdleTimer, cleanup, refreshTheme, get _mouseStillSince() { return mouseStillSince; } };

};
