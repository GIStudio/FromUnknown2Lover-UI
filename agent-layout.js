const CONVERSATION_TONE_PRIORITY = {
  mutual: 2,
  approach: 1,
};

const MIN_AGENT_SCALE = 0.72;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnit(key) {
  return hashString(key) / 0xffffffff;
}

function squaredDistance(first, second) {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function objectBounds(object) {
  const paddingX = Math.min(5, Math.max(3, Number(object.width) * 0.065));
  const paddingY = Math.min(5, Math.max(3, Number(object.height) * 0.07));
  return {
    left: Number(object.x) + paddingX,
    right: Number(object.x) + Number(object.width) - paddingX,
    top: Number(object.y) + paddingY,
    bottom: Number(object.y) + Number(object.height) - paddingY,
  };
}

function gridForCapacity(bounds, capacity) {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  let best = null;

  for (let columns = 1; columns <= capacity; columns += 1) {
    const rows = Math.ceil(capacity / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const scale = Math.min(cellWidth / 10, cellHeight / 19, 1);
    const emptyCells = columns * rows - capacity;
    const score = scale * 100 - emptyCells * 0.1 - Math.abs(cellWidth / cellHeight - 0.72) * 0.01;
    if (!best || score > best.score) best = { columns, rows, cellWidth, cellHeight, score };
  }
  return best;
}

function createSlots(object, capacity, seed) {
  const bounds = objectBounds(object);
  const grid = gridForCapacity(bounds, Math.max(1, capacity));
  const slots = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const slotKey = `${seed}:${object.id}:${row}:${column}`;
      const jitterX = (randomUnit(`${slotKey}:x`) - 0.5) * Math.min(grid.cellWidth * 0.28, 3.2);
      const jitterY = (randomUnit(`${slotKey}:y`) - 0.5) * Math.min(grid.cellHeight * 0.08, 1.2);
      slots.push({
        x: clamp(bounds.left + grid.cellWidth * (column + 0.5) + jitterX, bounds.left, bounds.right),
        y: clamp(bounds.top + grid.cellHeight * (row + 0.5) + jitterY, bounds.top, bounds.bottom),
      });
    }
  }

  slots.sort((first, second) => hashString(`${seed}:${object.id}:${first.x}:${first.y}`) - hashString(`${seed}:${object.id}:${second.x}:${second.y}`));
  return {
    bounds,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    scale: clamp(Math.min(grid.cellWidth / 10, grid.cellHeight / 19, 1), MIN_AGENT_SCALE, 1),
    slots,
  };
}

function selectConversationPairs(frame, frameEvents) {
  const agentById = new Map(frame.agents.map((agent) => [Number(agent.id), agent]));
  const candidates = frameEvents
    .map((event, order) => ({ event, order }))
    .filter(({ event }) => {
      if (!Object.hasOwn(CONVERSATION_TONE_PRIORITY, event.tone)) return false;
      const source = agentById.get(Number(event.source));
      const target = agentById.get(Number(event.target));
      return Boolean(
        source
        && target
        && source.display?.mapObjectId
        && source.display.mapObjectId === target.display?.mapObjectId,
      );
    })
    .sort((first, second) => {
      const toneDifference = CONVERSATION_TONE_PRIORITY[second.event.tone] - CONVERSATION_TONE_PRIORITY[first.event.tone];
      return toneDifference || first.order - second.order;
    });

  const selected = [];
  const usedAgentIds = new Set();
  const usedPairKeys = new Set();
  candidates.forEach(({ event, order }) => {
    const source = Number(event.source);
    const target = Number(event.target);
    const pairKey = [source, target].sort((a, b) => a - b).join(":");
    if (usedPairKeys.has(pairKey) || usedAgentIds.has(source) || usedAgentIds.has(target)) return;
    usedPairKeys.add(pairKey);
    usedAgentIds.add(source);
    usedAgentIds.add(target);
    selected.push({
      id: `conversation-${frame.step}-${pairKey.replace(":", "-")}`,
      entityKey: `pair:${pairKey}`,
      eventId: String(event.id),
      order,
      source,
      target,
      tone: event.tone,
      mapObjectId: agentById.get(source).display.mapObjectId,
    });
  });
  return selected;
}

function prepareFrames(frames, events) {
  const eventsByStep = new Map();
  events.forEach((event) => {
    const key = String(event.step);
    if (!eventsByStep.has(key)) eventsByStep.set(key, []);
    eventsByStep.get(key).push(event);
  });

  const capacityByObject = new Map();
  const prepared = frames.map((frame) => {
    const conversations = selectConversationPairs(frame, eventsByStep.get(String(frame.step)) || []);
    const conversationByObject = new Map();
    conversations.forEach((conversation) => {
      if (!conversationByObject.has(conversation.mapObjectId)) conversationByObject.set(conversation.mapObjectId, []);
      conversationByObject.get(conversation.mapObjectId).push(conversation);
    });

    const agentsByObject = new Map();
    frame.agents.forEach((agent) => {
      const objectId = agent.display?.mapObjectId;
      if (!objectId) return;
      if (!agentsByObject.has(objectId)) agentsByObject.set(objectId, []);
      agentsByObject.get(objectId).push(agent);
    });

    const groups = new Map();
    agentsByObject.forEach((agents, objectId) => {
      const objectConversations = conversationByObject.get(objectId) || [];
      groups.set(objectId, { agents, conversations: objectConversations });
      capacityByObject.set(objectId, Math.max(capacityByObject.get(objectId) || 0, agents.length));
    });
    return { frame, conversations, groups };
  });

  return { prepared, capacityByObject };
}

function preferredSlot(agentId, available, slots, previousAgentPositions, objectId, seed) {
  const previous = previousAgentPositions.get(agentId);
  if (previous?.mapObjectId === objectId) {
    return [...available].sort((first, second) => {
      const distanceDifference = squaredDistance(slots[first], previous) - squaredDistance(slots[second], previous);
      return distanceDifference || hashString(`${seed}:${agentId}:${first}`) - hashString(`${seed}:${agentId}:${second}`);
    })[0];
  }
  return [...available].sort((first, second) => hashString(`${seed}:${agentId}:${second}`) - hashString(`${seed}:${agentId}:${first}`))[0];
}

function pairSlotAssignment(conversation, available, slots, remembered, previousAgentPositions, objectId, seed) {
  const indexes = [...available];
  let best = null;
  for (let first = 0; first < indexes.length; first += 1) {
    for (let second = first + 1; second < indexes.length; second += 1) {
      const firstIndex = indexes[first];
      const secondIndex = indexes[second];
      const slotDistance = Math.sqrt(squaredDistance(slots[firstIndex], slots[secondIndex]));
      const distancePenalty = Math.abs(slotDistance - 9) * 24 + (slotDistance > 14 ? 500 : 0);
      const orientations = [
        { sourceIndex: firstIndex, targetIndex: secondIndex },
        { sourceIndex: secondIndex, targetIndex: firstIndex },
      ];
      orientations.forEach((orientation) => {
        let score = distancePenalty;
        const sourcePrevious = previousAgentPositions.get(conversation.source);
        const targetPrevious = previousAgentPositions.get(conversation.target);
        if (sourcePrevious?.mapObjectId === objectId) score += squaredDistance(slots[orientation.sourceIndex], sourcePrevious) * 0.22;
        if (targetPrevious?.mapObjectId === objectId) score += squaredDistance(slots[orientation.targetIndex], targetPrevious) * 0.22;
        if (remembered.get(conversation.source) === orientation.sourceIndex) score -= 80;
        if (remembered.get(conversation.target) === orientation.targetIndex) score -= 80;
        score += randomUnit(`${seed}:${conversation.entityKey}:${orientation.sourceIndex}:${orientation.targetIndex}`) * 0.01;
        if (!best || score < best.score) best = { ...orientation, score };
      });
    }
  }
  return best;
}

function pullPairTogether(first, second) {
  const distance = Math.sqrt(squaredDistance(first, second));
  const targetDistance = clamp(distance, 7, 10);
  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const direction = distance > 0.0001
    ? { x: (first.x - second.x) / distance, y: (first.y - second.y) / distance }
    : { x: 1, y: 0 };
  return [
    { x: midpoint.x + direction.x * targetDistance / 2, y: midpoint.y + direction.y * targetDistance / 2 },
    { x: midpoint.x - direction.x * targetDistance / 2, y: midpoint.y - direction.y * targetDistance / 2 },
  ];
}

/**
 * Build stable, display-only Agent positions for every projected replay frame.
 * Input Agent records must already contain display.mapObjectId for mapped scenes.
 */
export function buildReplayLayout({ frames, events, map, seed = "agent-layout" }) {
  const { prepared, capacityByObject } = prepareFrames(frames, events);
  const objectById = new Map(map.objects.map((object) => [object.id, object]));
  const slotPlans = new Map();
  capacityByObject.forEach((capacity, objectId) => {
    const object = objectById.get(objectId);
    if (object) slotPlans.set(objectId, createSlots(object, capacity, seed));
  });

  const rememberedSlots = new Map();
  const previousAgentPositions = new Map();
  const byStep = new Map();

  prepared.forEach(({ frame, conversations, groups }) => {
    const positions = new Map();
    groups.forEach(({ agents, conversations: objectConversations }, objectId) => {
      const object = objectById.get(objectId);
      const slotPlan = slotPlans.get(objectId);
      if (!object || !slotPlan) return;
      if (!rememberedSlots.has(objectId)) rememberedSlots.set(objectId, new Map());
      const remembered = rememberedSlots.get(objectId);
      const available = new Set(slotPlan.slots.map((_, index) => index));
      const assigned = new Map();
      const conversationByAgent = new Map();
      const orderedConversations = [...objectConversations].sort((first, second) => hashString(`${seed}:${first.entityKey}`) - hashString(`${seed}:${second.entityKey}`));

      orderedConversations.forEach((conversation) => {
        const assignment = pairSlotAssignment(conversation, available, slotPlan.slots, remembered, previousAgentPositions, objectId, seed);
        if (!assignment) return;
        assigned.set(conversation.source, assignment.sourceIndex);
        assigned.set(conversation.target, assignment.targetIndex);
        conversationByAgent.set(conversation.source, conversation);
        conversationByAgent.set(conversation.target, conversation);
        available.delete(assignment.sourceIndex);
        available.delete(assignment.targetIndex);
        remembered.set(conversation.source, assignment.sourceIndex);
        remembered.set(conversation.target, assignment.targetIndex);
      });

      const unpairedAgents = agents
        .map((agent) => Number(agent.id))
        .filter((agentId) => !assigned.has(agentId))
        .sort((first, second) => hashString(`${seed}:${objectId}:${first}`) - hashString(`${seed}:${objectId}:${second}`));
      unpairedAgents.forEach((agentId) => {
        const rememberedIndex = remembered.get(agentId);
        if (!available.has(rememberedIndex)) return;
        assigned.set(agentId, rememberedIndex);
        available.delete(rememberedIndex);
      });
      unpairedAgents.forEach((agentId) => {
        if (assigned.has(agentId)) return;
        const slotIndex = preferredSlot(agentId, available, slotPlan.slots, previousAgentPositions, objectId, seed);
        assigned.set(agentId, slotIndex);
        available.delete(slotIndex);
        remembered.set(agentId, slotIndex);
      });

      const worldPositions = new Map([...assigned].map(([agentId, slotIndex]) => [agentId, { ...slotPlan.slots[slotIndex] }]));
      orderedConversations.forEach((conversation) => {
        const sourcePosition = worldPositions.get(conversation.source);
        const targetPosition = worldPositions.get(conversation.target);
        if (!sourcePosition || !targetPosition) return;
        const [source, target] = pullPairTogether(sourcePosition, targetPosition);
        worldPositions.set(conversation.source, source);
        worldPositions.set(conversation.target, target);
      });

      worldPositions.forEach((position, agentId) => {
        const conversation = conversationByAgent.get(agentId);
        const layout = {
          x: (position.x / Number(map.world.width)) * 100,
          y: (position.y / Number(map.world.height)) * 100,
          worldX: position.x,
          worldY: position.y,
          scale: slotPlan.scale,
          conversationId: conversation?.id || null,
          conversationTone: conversation?.tone || null,
        };
        positions.set(agentId, layout);
        previousAgentPositions.set(agentId, { x: position.x, y: position.y, mapObjectId: objectId });
      });
    });

    byStep.set(String(frame.step), {
      positions,
      conversations: conversations.map(({ entityKey, order, ...conversation }) => conversation),
    });
  });

  return { byStep };
}
