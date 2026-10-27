"use strict";

// Pure decision rules for the desktop-pet "typing" and "listening" states.
// Extracted verbatim from the tick loop so they can be regression-tested.
// Each function returns null (no change) or a transition:
//   { state, beforeTypingVariant?, base?, clearShuffle? }
// `base` is the idle variant the hover logic should return to afterwards.

const TYPING_ENTRY_STATES = new Set(["idle", "idle2", "listening"]);
const LISTENING_ENTRY_STATES = new Set(["idle", "idle2"]);

/** Typing wins over listening: evaluated first each tick. */
function typingTransition({ currentState, textFocused, mediaPlaying, beforeTypingVariant }) {
  if (textFocused && TYPING_ENTRY_STATES.has(currentState)) {
    return { state: "typing", beforeTypingVariant: currentState, clearShuffle: true };
  }
  if (!textFocused && currentState === "typing") {
    if (beforeTypingVariant === "listening" && mediaPlaying) return { state: "listening", base: "listening" };
    if (beforeTypingVariant === "idle2") return { state: "idle2", base: "idle2" };
    return { state: "idle", base: "idle" };
  }
  return null;
}

/** Evaluated after typingTransition, against the possibly-updated state. */
function mediaTransition({ currentState, textFocused, mediaPlaying }) {
  if (textFocused) return null;
  if (mediaPlaying && LISTENING_ENTRY_STATES.has(currentState)) {
    return { state: "listening", clearShuffle: true };
  }
  if (!mediaPlaying && currentState === "listening") return { state: "idle", base: "idle" };
  return null;
}

module.exports = { typingTransition, mediaTransition };
