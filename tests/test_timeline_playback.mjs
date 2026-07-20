import assert from "node:assert/strict";
import {
  LOOP_PAUSE_MS,
  buildTimelineMarkers,
  createPlaybackWindow,
  samplePlaybackWindow,
  transitionDuration,
} from "../timeline-playback.js";

const frames = [
  { step: 0, time: "18:00" },
  { step: 1, time: "18:10" },
  { step: 2, time: "18:20" },
];
const events = [
  { id: "a", step: 0, source: 1, target: 2, dialogueTurns: [{ text: "Hello" }] },
  { id: "b", step: 0, source: 3, target: 4, dialogueTurns: [{ text: "Hi" }, { text: "Welcome" }] },
  { id: "c", step: 2, source: 1, target: 3, content: "Legacy encounter" },
];

assert.deepEqual(buildTimelineMarkers(frames, events).map(({ step, dialogueCount, turnCount, position }) => ({ step, dialogueCount, turnCount, position })), [
  { step: 0, dialogueCount: 2, turnCount: 3, position: 0 },
  { step: 1, dialogueCount: 0, turnCount: 0, position: 0.5 },
  { step: 2, dialogueCount: 1, turnCount: 1, position: 1 },
]);

assert.equal(transitionDuration(450), 315);
assert.equal(transitionDuration(900), 630);
assert.equal(transitionDuration(4000), 900);
assert.ok(LOOP_PAUSE_MS > 0);

const windowState = createPlaybackWindow({ frameIndex: 3, frameCount: 14, dwellMs: 900 });
assert.equal(windowState.totalMs, 1530);
assert.deepEqual(samplePlaybackWindow(windowState, 0), {
  elapsed: 0,
  phase: "dwell",
  progress: 0,
  transitionProgress: 0,
  cursor: 3,
});
assert.equal(samplePlaybackWindow(windowState, 899).phase, "dwell");
assert.equal(samplePlaybackWindow(windowState, 900).phase, "transition");
assert.equal(samplePlaybackWindow(windowState, 1215).transitionProgress, 0.5);
assert.equal(samplePlaybackWindow(windowState, 1530).phase, "complete");
assert.equal(samplePlaybackWindow(windowState, 1530).cursor, 4);

console.log("timeline playback tests passed");
