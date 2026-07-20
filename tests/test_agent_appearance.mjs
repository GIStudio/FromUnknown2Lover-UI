import assert from "node:assert/strict";
import { buildAgentAppearance, genderFromAgent, normalizeGender } from "../agent-appearance.js";

assert.equal(normalizeGender("female"), "female");
assert.equal(normalizeGender("女性"), "female");
assert.equal(normalizeGender("M"), "male");
assert.equal(normalizeGender("nonbinary"), "neutral");
assert.equal(genderFromAgent({ profile: { gender: "female" } }), "female");
assert.equal(genderFromAgent({ sex: "男" }), "male");

const female = buildAgentAppearance({ id: 2, name: "Mia", profile: { gender: "female" } });
const male = buildAgentAppearance({ id: 1, name: "Lin", profile: { gender: "male" } });
const repeated = buildAgentAppearance({ id: 2, name: "Mia", profile: { gender: "female" } });

assert.equal(female.gender, "female");
assert.ok(["sprite-1", "sprite-2", "sprite-3"].includes(female.spriteId));
assert.equal(male.gender, "male");
assert.ok(["sprite-4", "sprite-5", "sprite-6"].includes(male.spriteId));
assert.deepEqual(female, repeated, "appearance must be deterministic");

const override = buildAgentAppearance(
  { id: 2, name: "Mia", profile: { gender: "female" } },
  { gender: "female" },
  { spriteId: "sprite-6", direction: "right", frame: 2 },
);
assert.equal(override.spriteId, "sprite-6");
assert.equal(override.direction, "right");
assert.equal(override.frame, 2);

console.log("agent appearance tests passed");
