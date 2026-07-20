import assert from "node:assert/strict";
import {
  activeDialogueEntries,
  buildEncounterGroups,
  groupTurnCount,
  normalizeDialogueTurns,
  playbackDuration,
  turnDurationFromFrameDelay,
} from "../encounter-playback.js";

const event = {
  id: "e1",
  source: 1,
  target: 2,
  content: "fallback",
  dialogueTurns: [
    { index: 0, speakerRole: "source", speakerId: 1, kind: "speech", text: "Hello" },
    { index: 1, speakerRole: "target", speakerId: 2, kind: "speech", text: "Hi" },
    { index: 2, speakerRole: "npc", speakerId: null, kind: "speech", text: "Last order" },
  ],
};

assert.deepEqual(normalizeDialogueTurns({ source: 1, target: 2, content: "legacy" }), [{
  index: 0,
  speakerRole: "source",
  speakerId: 1,
  kind: "speech",
  text: "legacy",
}]);

assert.equal(activeDialogueEntries([event], 0)[0].anchorId, 1);
assert.equal(activeDialogueEntries([event], 1)[0].anchorId, 2);
assert.equal(activeDialogueEntries([event], 2)[0].anchorId, 1);
assert.equal(groupTurnCount([event]), 3);
assert.equal(playbackDuration([[event]], 1800), 5400);
assert.equal(turnDurationFromFrameDelay(900), 1800);
assert.equal(turnDurationFromFrameDelay(450), 900);

const events = Array.from({ length: 10 }, (_, index) => ({
  ...event,
  id: `e${index}`,
  source: index * 2 + 1,
  target: index * 2 + 2,
}));
const groups = buildEncounterGroups(events);
assert.equal(groups.length, 4);
assert.deepEqual(groups.map((group) => group.length), [3, 3, 2, 2]);
assert.ok(groups.every((group) => group.length <= 3));

console.log("encounter playback tests passed");
