import { normalizeDialogueTurns } from "./encounter-playback.js?v=20260720-timeline-guide";

export const LOOP_PAUSE_MS = 280;
export const MIN_TRANSITION_MS = 260;
export const MAX_TRANSITION_MS = 900;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function dialogueEventsAtStep(events, step) {
  return events.filter((event) => Number(event.step) === Number(step) && normalizeDialogueTurns(event).length > 0);
}

export function buildTimelineMarkers(frames, events) {
  const lastIndex = Math.max(1, frames.length - 1);
  return frames.map((frame, index) => {
    const dialogueEvents = dialogueEventsAtStep(events, frame.step);
    return {
      index,
      step: Number(frame.step),
      time: String(frame.time || ""),
      dialogueCount: dialogueEvents.length,
      turnCount: dialogueEvents.reduce((total, event) => total + normalizeDialogueTurns(event).length, 0),
      position: frames.length <= 1 ? 0 : index / lastIndex,
    };
  });
}

export function transitionDuration(dwellMs) {
  return Math.round(clamp(Number(dwellMs) * 0.7, MIN_TRANSITION_MS, MAX_TRANSITION_MS));
}

export function createPlaybackWindow({ frameIndex, frameCount, dwellMs }) {
  const transitionMs = transitionDuration(dwellMs);
  return {
    frameIndex: Number(frameIndex),
    frameCount: Number(frameCount),
    dwellMs: Math.max(0, Number(dwellMs) || 0),
    transitionMs,
    totalMs: Math.max(1, Number(dwellMs) || 0) + transitionMs,
  };
}

export function samplePlaybackWindow(windowState, elapsedMs) {
  const elapsed = clamp(elapsedMs, 0, windowState.totalMs);
  const phase = elapsed < windowState.dwellMs
    ? "dwell"
    : elapsed < windowState.totalMs
      ? "transition"
      : "complete";
  const progress = clamp(elapsed / windowState.totalMs, 0, 1);
  const transitionProgress = phase === "dwell"
    ? 0
    : clamp((elapsed - windowState.dwellMs) / windowState.transitionMs, 0, 1);
  return {
    elapsed,
    phase,
    progress,
    transitionProgress,
    cursor: windowState.frameIndex + progress,
  };
}
