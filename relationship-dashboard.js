export const RELATIONSHIP_METRICS = Object.freeze([
  ["familiarity", "FAM"],
  ["trust", "TRUST"],
  ["mutualAttraction", "ATTR"],
]);

export const STAGE_RANK = Object.freeze({
  unknown: -1,
  stranger: 0,
  recognized: 1,
  acquaintance: 2,
  mutual_interest: 3,
  invitation_made: 4,
  date_accepted: 5,
  ongoing_dating: 6,
  relationship_confirmed: 7,
});

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function relationshipKey(event) {
  return [Number(event.source), Number(event.target)].sort((first, second) => first - second).join(":");
}

function normalizedRecord(event) {
  const progress = event.relationshipProgress || {};
  const legacy = event.relationshipMetrics || {};
  const attractionA = numberOrNull(legacy.attractionAToB);
  const attractionB = numberOrNull(legacy.attractionBToA);
  const legacyMutualAttraction = attractionA !== null && attractionB !== null
    ? Math.min(attractionA, attractionB)
    : null;
  return {
    source: Number(event.source),
    target: Number(event.target),
    stage: String(progress.stage || "unknown"),
    activeStatus: String(progress.activeStatus || "active"),
    metrics: {
      familiarity: numberOrNull(progress.metrics?.familiarity ?? legacy.familiarity),
      trust: numberOrNull(progress.metrics?.trust ?? legacy.trust),
      mutualAttraction: numberOrNull(progress.metrics?.mutualAttraction ?? legacyMutualAttraction),
    },
    milestones: progress.milestones || {},
    eventId: String(event.id),
  };
}

function average(records, metric) {
  const values = records.map((record) => record.metrics[metric]).filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function latestStage(records) {
  return records.reduce(
    (best, record) => (STAGE_RANK[record.stage] ?? -1) > (STAGE_RANK[best] ?? -1) ? record.stage : best,
    "unknown",
  );
}

function activeStatus(records) {
  const statuses = records.map((record) => record.activeStatus);
  if (statuses.includes("withdrawn")) return "withdrawn";
  if (statuses.includes("declined")) return "declined";
  if (statuses.includes("stalled")) return "stalled";
  return "active";
}

export function buildRelationshipDashboard({ agents, frames, events }) {
  const sortedFrames = [...frames].sort((first, second) => first.step - second.step);
  const eventsByStep = new Map();
  [...events]
    .filter((event) => event.source !== null && event.target !== null)
    .sort((first, second) => first.step - second.step)
    .forEach((event) => {
      const grouped = eventsByStep.get(event.step) || [];
      grouped.push(normalizedRecord(event));
      eventsByStep.set(event.step, grouped);
    });
  const latestByDyad = new Map();
  const byAgent = new Map(agents.map((agent) => [Number(agent.id), []]));
  const overview = [];

  sortedFrames.forEach((frame) => {
    const changed = eventsByStep.get(frame.step) || [];
    changed.forEach((record) => latestByDyad.set(relationshipKey(record), record));
    const districtRecords = [...latestByDyad.values()];
    overview.push({
      step: frame.step,
      time: frame.time,
      metrics: Object.fromEntries(RELATIONSHIP_METRICS.map(([metric]) => [metric, average(districtRecords, metric)])),
      dyadCount: districtRecords.length,
      activeAgentCount: new Set(districtRecords.flatMap((record) => [record.source, record.target])).size,
      changes: changed,
    });
    agents.forEach((agent) => {
      const id = Number(agent.id);
      const records = [...latestByDyad.values()].filter((record) => record.source === id || record.target === id);
      const changes = changed.filter((record) => record.source === id || record.target === id);
      byAgent.get(id).push({
        step: frame.step,
        time: frame.time,
        metrics: Object.fromEntries(RELATIONSHIP_METRICS.map(([metric]) => [metric, average(records, metric)])),
        stage: latestStage(records),
        activeStatus: activeStatus(records),
        dyadCount: records.length,
        changes,
      });
    });
  });
  return { frames: sortedFrames, byAgent, overview };
}

function milestoneStatus(snapshot, key) {
  return snapshot.changes.some((record) => {
    const status = record.milestones?.[key]?.status;
    return status === "verified" || status === "unclaimed_evidence";
  });
}

export function relationshipPulse(series, index) {
  const current = series[index];
  const previous = series[index - 1];
  if (!current || !previous || current.dyadCount === 0) return null;
  if (["declined", "withdrawn"].includes(current.activeStatus) && current.activeStatus !== previous.activeStatus) {
    return { symbol: "♥", tone: "regression", kind: current.activeStatus };
  }
  const stageChange = (STAGE_RANK[current.stage] ?? -1) - (STAGE_RANK[previous.stage] ?? -1);
  if (stageChange > 0) {
    const symbols = {
      recognized: "◉",
      acquaintance: "…",
      mutual_interest: "♥",
      invitation_made: "✉",
      date_accepted: "♥",
      ongoing_dating: "✦",
      relationship_confirmed: "♥",
    };
    return { symbol: symbols[current.stage] || "✦", tone: current.stage.includes("interest") || current.stage.includes("accepted") || current.stage.includes("confirmed") ? "affection" : "state", kind: current.stage };
  }
  if (milestoneStatus(current, "relationshipConfirmed") || milestoneStatus(current, "dateAccepted")) {
    return { symbol: "♥", tone: "affection", kind: "milestone" };
  }
  if (milestoneStatus(current, "dateInvitation")) return { symbol: "✉", tone: "state", kind: "invitation_made" };
  if (milestoneStatus(current, "contactExchange")) return { symbol: "☎", tone: "state", kind: "contact" };
  if (milestoneStatus(current, "secondMeeting")) return { symbol: "↻", tone: "state", kind: "meeting" };
  const attractionDelta = (current.metrics.mutualAttraction ?? 0) - (previous.metrics.mutualAttraction ?? 0);
  if (attractionDelta >= 0.035) return { symbol: "♥", tone: "affection", kind: "affection_up" };
  if (attractionDelta <= -0.035) return { symbol: "♥", tone: "regression", kind: "affection_down" };
  const trustDelta = (current.metrics.trust ?? 0) - (previous.metrics.trust ?? 0);
  if (trustDelta >= 0.08) return { symbol: "✦", tone: "state", kind: "trust_up" };
  if (trustDelta <= -0.08) return { symbol: "↘", tone: "regression", kind: "trust_down" };
  return null;
}

export function linePath(series, metric, width = 246, height = 104, padding = 10) {
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  return series.reduce((path, point, index) => {
    const value = point.metrics?.[metric];
    if (value === null || value === undefined) return path;
    const x = padding + (series.length <= 1 ? 0.5 : index / (series.length - 1)) * usableWidth;
    const y = height - padding - value * usableHeight;
    const previous = series[index - 1]?.metrics?.[metric];
    return `${path}${previous === null || previous === undefined ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }, "");
}
