import assert from "node:assert/strict";
import { buildRelationshipDashboard, linePath, relationshipPulse } from "../relationship-dashboard.js";

const agents = [{ id: 1 }, { id: 2 }, { id: 3 }];
const frames = [{ step: 0, time: "t0" }, { step: 1, time: "t1" }, { step: 2, time: "t2" }];
const event = (step, familiarity, trust, attraction, stage = "acquaintance", activeStatus = "active") => ({
  id: `e-${step}`,
  step,
  source: 1,
  target: 2,
  relationshipProgress: {
    stage,
    activeStatus,
    metrics: { familiarity, trust, mutualAttraction: attraction },
    milestones: {},
  },
});
const dashboard = buildRelationshipDashboard({
  agents,
  frames,
  events: [event(0, 0.2, 0.1, 0.1), event(1, 0.4, 0.25, 0.2), event(2, 0.45, 0.2, 0.1)],
});
const series = dashboard.byAgent.get(1);
assert.equal(series.length, 3);
assert.equal(series[1].metrics.familiarity, 0.4);
assert.equal(dashboard.byAgent.get(3)[2].dyadCount, 0);
assert.equal(relationshipPulse(series, 1).symbol, "♥");
assert.equal(relationshipPulse(series, 2).tone, "regression");
assert.match(linePath(series, "trust"), /^M/);
assert.ok(linePath(dashboard.byAgent.get(3), "trust") === "");

const regression = buildRelationshipDashboard({
  agents,
  frames: frames.slice(0, 2),
  events: [event(0, 0.5, 0.5, 0.5), event(1, 0.5, 0.5, 0.5, "acquaintance", "declined")],
});
assert.equal(relationshipPulse(regression.byAgent.get(1), 1).tone, "regression");
console.log("relationship dashboard tests passed");
