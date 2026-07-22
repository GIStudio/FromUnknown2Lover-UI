import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const replay = JSON.parse(
  await readFile(new URL("../data/agent-society-latest-snapshot.json", import.meta.url), "utf8"),
);

assert.equal(replay.meta.title, "AgentSociety latest sample — 2026-07-22 16:51");
assert.match(replay.meta.description, /profile-only export/);
assert.equal(replay.agents.length, 51);
assert.equal(replay.frames.length, 1);
assert.equal(replay.events.length, 0);
assert.equal(replay.frames[0].agents.length, replay.agents.length);

console.log("default replay sample test passed");
