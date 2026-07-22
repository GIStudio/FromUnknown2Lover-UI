import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [replay, summary, appSource] = await Promise.all([
  readFile(new URL("../data/packed_encounter_14_20260719_064154.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../data/packed_encounter_14_20260719_064154.summary.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
]);

assert.match(appSource, /requestedReplay \|\| "packed_encounter_14_20260719_064154\.json"/);
assert.equal(replay.meta.title, "Packed Encounter 14");
assert.equal(replay.agents.length, 30);
assert.equal(replay.frames.length, 14);
assert.equal(replay.events.length, 138);
assert.equal(summary.coverage.complete, true);
assert.equal(summary.coverage.observedAgentSteps, replay.agents.length * replay.frames.length);
assert.equal(summary.counts.interactions, replay.events.length);

console.log("default replay sample test passed");
