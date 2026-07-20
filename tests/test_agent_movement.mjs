import assert from "node:assert/strict";
import {
  buildMovementPlan,
  buildRoadRoute,
  movementDirectionAt,
  movementKeyframes,
  movementDirection,
  movementPath,
  movementPoint,
  normalizeMovementMode,
} from "../agent-movement.js";

const previous = { frameIndex: 2, agents: [{ id: 1, display: { x: 10, y: 20 } }, { id: 2, display: { x: 30, y: 40 } }] };
const adjacent = { frameIndex: 3, agents: [{ id: 1, display: { x: 20, y: 22 } }, { id: 2, display: { x: 30.1, y: 40.1 } }] };
const plan = buildMovementPlan(previous, adjacent);

assert.equal(plan.length, 1);
assert.equal(plan[0].id, 1);
assert.equal(plan[0].direction, "right");
assert.deepEqual(movementPoint(plan[0], 0.5), { x: 15, y: 21 });
assert.match(movementPath(plan[0]), /^M 10\.000 20\.000 Q /);
assert.equal(buildMovementPlan(previous, { ...adjacent, frameIndex: 6 }).length, 0, "timeline jumps must not invent paths");
assert.equal(buildMovementPlan(previous, previous).length, 0);
assert.equal(movementDirection({ x: 5, y: 5 }, { x: 5, y: 1 }), "back");
assert.equal(normalizeMovementMode("ghost"), "ghost");
assert.equal(normalizeMovementMode("normal"), "normal");
assert.equal(normalizeMovementMode("unknown"), "trail");

const crossRoadMap = {
  world: { width: 100, height: 100 },
  objects: [
    { id: "vertical", kind: "road", variant: "vertical", x: 45, y: 0, width: 10, height: 100 },
    { id: "horizontal", kind: "road", variant: "horizontal", x: 0, y: 45, width: 100, height: 10 },
  ],
};
const roadRoute = buildRoadRoute({ x: 10, y: 30 }, { x: 70, y: 90 }, crossRoadMap);
assert.deepEqual(roadRoute, [
  { x: 10, y: 30 },
  { x: 10, y: 50 },
  { x: 50, y: 50 },
  { x: 50, y: 90 },
  { x: 70, y: 90 },
]);
const roadPrevious = { frameIndex: 4, agents: [{ id: 1, display: { x: 10, y: 30 }, mapObjectId: "a" }] };
const roadCurrent = { frameIndex: 5, agents: [{ id: 1, display: { x: 70, y: 90 }, mapObjectId: "b" }] };
const [roadMovement] = buildMovementPlan(roadPrevious, roadCurrent, { roadMap: crossRoadMap });
assert.equal(roadMovement.routeMode, "road");
assert.match(movementPath(roadMovement), / L /);
assert.deepEqual(movementPoint(roadMovement, 0.5), { x: 50, y: 50 });
assert.equal(movementDirectionAt(roadMovement, 0.1), "front");
const roadKeyframes = movementKeyframes(roadMovement);
assert.equal(roadKeyframes[0].offset, 0);
assert.equal(roadKeyframes.at(-1).offset, 1);

const sameVenueCurrent = { frameIndex: 5, agents: [{ id: 1, display: { x: 70, y: 90 }, mapObjectId: "a" }] };
assert.equal(buildMovementPlan(roadPrevious, sameVenueCurrent, { roadMap: crossRoadMap })[0].routeMode, "direct");

console.log("agent movement tests passed");
