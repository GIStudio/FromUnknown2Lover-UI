import assert from "node:assert/strict";
import test from "node:test";

import { buildReplayLayout } from "../agent-layout.js";

const map = {
  id: "layout-test",
  world: { width: 240, height: 360 },
  objects: [{ id: "venue", x: 10, y: 20, width: 50, height: 48 }],
};

function agents(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    display: { x: 20, y: 20, mapObjectId: "venue", projection: "building" },
  }));
}

function serialize(layout) {
  return [...layout.byStep.entries()].map(([step, frame]) => ({
    step,
    positions: [...frame.positions.entries()].sort(([first], [second]) => first - second),
    conversations: frame.conversations,
  }));
}

function distance(first, second) {
  return Math.hypot(first.worldX - second.worldX, first.worldY - second.worldY);
}

test("stable scene layout is deterministic, bounded, and dispersed", () => {
  const frames = [
    { step: 0, agents: agents(10) },
    { step: 1, agents: agents(10) },
  ];
  const inputSnapshot = JSON.stringify({ frames, map });
  const first = buildReplayLayout({ frames, events: [], map, seed: "repeatable" });
  const second = buildReplayLayout({ frames, events: [], map, seed: "repeatable" });
  assert.deepEqual(serialize(first), serialize(second));
  assert.equal(JSON.stringify({ frames, map }), inputSnapshot, "layout must not mutate source data");

  const positions = [...first.byStep.get("0").positions.values()];
  positions.forEach((position) => {
    assert.ok(position.worldX >= map.objects[0].x && position.worldX <= map.objects[0].x + map.objects[0].width);
    assert.ok(position.worldY >= map.objects[0].y && position.worldY <= map.objects[0].y + map.objects[0].height);
    assert.ok(position.scale >= 0.72 && position.scale <= 1);
  });
  const distances = positions.flatMap((position, index) => positions.slice(index + 1).map((other) => distance(position, other)));
  assert.ok(Math.min(...distances) >= 6.5, `minimum spacing was ${Math.min(...distances)}`);

  const nextPositions = first.byStep.get("1").positions;
  first.byStep.get("0").positions.forEach((position, agentId) => {
    assert.equal(nextPositions.get(agentId).worldX, position.worldX);
    assert.equal(nextPositions.get(agentId).worldY, position.worldY);
  });
});

test("mutual and approach events form close pairs while safety does not", () => {
  const frames = [{ step: 7, agents: agents(6) }];
  const events = [
    { id: "mutual", step: 7, source: 1, target: 2, tone: "mutual" },
    { id: "approach", step: 7, source: 3, target: 4, tone: "approach" },
    { id: "safety", step: 7, source: 5, target: 6, tone: "safety" },
  ];
  const frame = buildReplayLayout({ frames, events, map, seed: "dialogue" }).byStep.get("7");
  assert.equal(frame.conversations.length, 2);
  assert.deepEqual(frame.conversations.map((item) => item.tone).sort(), ["approach", "mutual"]);

  [[1, 2], [3, 4]].forEach(([source, target]) => {
    const separation = distance(frame.positions.get(source), frame.positions.get(target));
    assert.ok(separation >= 7 && separation <= 10.0001, `conversation gap was ${separation}`);
    assert.equal(frame.positions.get(source).conversationId, frame.positions.get(target).conversationId);
  });
  assert.equal(frame.positions.get(5).conversationId, null);
  assert.equal(frame.positions.get(6).conversationId, null);
});

test("conflicting conversation events select one deterministic primary pair", () => {
  const frames = [{ step: 2, agents: agents(3) }];
  const events = [
    { id: "approach", step: 2, source: 1, target: 3, tone: "approach" },
    { id: "mutual", step: 2, source: 1, target: 2, tone: "mutual" },
  ];
  const frame = buildReplayLayout({ frames, events, map, seed: "priority" }).byStep.get("2");
  assert.equal(frame.conversations.length, 1);
  assert.equal(frame.conversations[0].eventId, "mutual");
  assert.equal(frame.positions.get(3).conversationId, null);
});

test("unmapped Agents stay outside the display-only layout", () => {
  const frames = [{ step: 0, agents: [{ id: 1, display: { x: 25, y: 40, mapObjectId: null, projection: "global" } }] }];
  const frame = buildReplayLayout({ frames, events: [], map, seed: "fallback" }).byStep.get("0");
  assert.equal(frame.positions.size, 0);
});
