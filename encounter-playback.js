export const ENCOUNTER_GROUP_SIZE = 3;
export const TURN_DURATION_AT_1X_MS = 1800;

const SPEAKER_ROLES = new Set(["source", "target", "npc", "self"]);

export function normalizeDialogueTurns(event) {
  const source = event.source == null ? null : Number(event.source);
  const target = event.target == null ? null : Number(event.target);
  const rawTurns = Array.isArray(event.dialogueTurns) && event.dialogueTurns.length
    ? event.dialogueTurns
    : Array.isArray(event.encounterTurns) && event.encounterTurns.length
      ? event.encounterTurns
      : [];
  const turns = rawTurns.flatMap((turn, fallbackIndex) => {
    const text = String(turn.text || turn.utterance || "").trim();
    if (!text) return [];
    const rawSpeaker = String(turn.speakerRole || turn.speaker || "source").toLowerCase();
    const targetHint = String(turn.target || "").toLowerCase();
    let speakerRole = SPEAKER_ROLES.has(rawSpeaker) ? rawSpeaker : "source";
    if (rawSpeaker === "agent") speakerRole = targetHint === "self" ? "self" : "source";
    if (["other", "partner"].includes(rawSpeaker)) speakerRole = "target";
    const speakerId = turn.speakerId == null
      ? speakerRole === "target" ? target : speakerRole === "npc" ? null : source
      : Number(turn.speakerId);
    return [{
      index: Number(turn.index ?? fallbackIndex),
      speakerRole,
      speakerId,
      kind: String(turn.kind || (speakerRole === "self" ? "action" : "speech")),
      text,
    }];
  });
  if (turns.length) return turns;
  return [{
    index: 0,
    speakerRole: "source",
    speakerId: source,
    kind: "speech",
    text: String(event.content || event.message || event.type || "Interaction"),
  }];
}

function participants(event) {
  return new Set([event.source, event.target].filter((value) => value !== null).map(Number));
}

export function buildEncounterGroups(events, displayFrame = null, groupSize = ENCOUNTER_GROUP_SIZE) {
  const unique = [];
  const seenSources = new Set();
  events.forEach((event) => {
    if (event.source === null || seenSources.has(Number(event.source))) return;
    seenSources.add(Number(event.source));
    unique.push({ ...event, dialogueTurns: normalizeDialogueTurns(event) });
  });
  if (!unique.length) return [[]];
  const groupCount = Math.ceil(unique.length / groupSize);
  const baseSize = Math.floor(unique.length / groupCount);
  const largerGroupCount = unique.length % groupCount;
  const groupSizes = Array.from({ length: groupCount }, (_, index) => baseSize + (index < largerGroupCount ? 1 : 0));
  const groups = groupSizes.map(() => []);
  const positions = new Map((displayFrame?.agents || []).map((agent) => [Number(agent.id), agent.display]));
  const buildingFrequency = new Map();
  unique.forEach((event) => {
    const key = event.buildingId || event.place || "unknown";
    buildingFrequency.set(key, (buildingFrequency.get(key) || 0) + 1);
  });
  const ordered = unique
    .map((event, order) => ({ event, order }))
    .sort((first, second) => {
      const firstKey = first.event.buildingId || first.event.place || "unknown";
      const secondKey = second.event.buildingId || second.event.place || "unknown";
      return buildingFrequency.get(secondKey) - buildingFrequency.get(firstKey) || first.order - second.order;
    });

  ordered.forEach(({ event }) => {
    const sourcePosition = positions.get(Number(event.source));
    const eventParticipants = participants(event);
    let best = null;
    groups.forEach((group, groupIndex) => {
      if (group.length >= groupSizes[groupIndex]) return;
      const participantCollision = group.some((item) => [...participants(item)].some((id) => eventParticipants.has(id)));
      const sameBuilding = group.some((item) => (item.buildingId || item.place) === (event.buildingId || event.place));
      const distances = group.map((item) => {
        const itemPosition = positions.get(Number(item.source));
        if (!sourcePosition || !itemPosition) return 0;
        return Math.hypot((sourcePosition.x - itemPosition.x) * 2 / 3, sourcePosition.y - itemPosition.y);
      });
      const minimumDistance = distances.length ? Math.min(...distances) : 1000;
      const score = minimumDistance - (participantCollision ? 10000 : 0) - (sameBuilding ? 500 : 0);
      if (!best || score > best.score) best = { groupIndex, score };
    });
    groups[best.groupIndex].push(event);
  });
  return groups;
}

export function groupTurnCount(group) {
  return Math.max(1, ...group.map((event) => normalizeDialogueTurns(event).length));
}

export function activeDialogueEntries(group, turnIndex) {
  return group.flatMap((event, slot) => {
    const turn = normalizeDialogueTurns(event)[turnIndex];
    if (!turn) return [];
    const anchorId = turn.speakerRole === "target" ? event.target : event.source;
    if (anchorId === null) return [];
    return [{ event, turn, slot, anchorId: Number(anchorId) }];
  });
}

export function playbackDuration(groups, turnDurationMs = TURN_DURATION_AT_1X_MS) {
  return groups.reduce((total, group) => total + groupTurnCount(group) * turnDurationMs, 0);
}

export function turnDurationFromFrameDelay(frameDelayMs) {
  const delay = Number(frameDelayMs);
  return TURN_DURATION_AT_1X_MS * (Number.isFinite(delay) && delay > 0 ? delay / 900 : 1);
}
