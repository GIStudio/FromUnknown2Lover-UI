import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const experimentIds = ["e-a", "e-b", "e-c"];
const [replays, summaries, appSource] = await Promise.all([
  Promise.all(experimentIds.map((id) => readFile(new URL(`../data/experiment-${id}.json`, import.meta.url), "utf8").then(JSON.parse))),
  Promise.all(experimentIds.map((id) => readFile(new URL(`../data/experiment-${id}.summary.json`, import.meta.url), "utf8").then(JSON.parse))),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
]);

assert.match(appSource, /DEFAULT_EXPERIMENT_ID = "e-c"/);
for (const [index, replay] of replays.entries()) {
  const experimentId = experimentIds[index];
  const summary = summaries[index];
  assert.equal(replay.meta.title, `Experiment ${experimentId.toUpperCase()}`);
  assert.equal(replay.meta.source, `Experiment ${experimentId.toUpperCase()}`);
  assert.equal(replay.agents.length, 50);
  assert.equal(replay.frames.length, 14);
  assert.ok(replay.events.length >= 200);
  assert.equal(summary.coverage.complete, true);
  assert.equal(summary.coverage.observedAgentSteps, replay.agents.length * replay.frames.length);
  assert.equal(summary.counts.interactions, replay.events.length);
}

console.log("default replay sample test passed");
