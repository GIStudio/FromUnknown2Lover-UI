export const MOVEMENT_MODES = Object.freeze(["off", "normal", "ghost", "trail"]);
export const DEFAULT_MOVEMENT_MODE = "trail";
export const MOVEMENT_MODE_KEY = "fromunknown2lover:movement-mode:v1";
export const ROAD_MOVEMENT_KEY = "fromunknown2lover:road-movement:v1";

export function normalizeMovementMode(value) {
  return MOVEMENT_MODES.includes(value) ? value : DEFAULT_MOVEMENT_MODE;
}

export function movementDirection(from, to) {
  const dx = Number(to.x) - Number(from.x);
  const dy = Number(to.y) - Number(from.y);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "front" : "back";
}

function pointDistance(first, second, scale = { x: 1, y: 1 }) {
  return Math.hypot((second.x - first.x) * scale.x, (second.y - first.y) * scale.y);
}

function samePoint(first, second) {
  return Math.abs(first.x - second.x) < 1e-6 && Math.abs(first.y - second.y) < 1e-6;
}

function simplifyPoints(points) {
  const unique = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1];
    const next = unique[index + 1];
    const cross = (point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x);
    return Math.abs(cross) > 1e-6;
  });
}

function roadSegments(map) {
  const width = Number(map?.world?.width);
  const height = Number(map?.world?.height);
  if (!(width > 0) || !(height > 0)) return [];
  return (map.objects || [])
    .filter((object) => object.kind === "road")
    .map((object, index) => {
      const horizontal = object.variant === "horizontal" || (object.variant !== "vertical" && object.width >= object.height);
      if (horizontal) {
        return {
          id: object.id || `road-${index}`,
          axis: "x",
          fixed: ((Number(object.y) + Number(object.height) / 2) / height) * 100,
          start: (Number(object.x) / width) * 100,
          end: ((Number(object.x) + Number(object.width)) / width) * 100,
          points: [],
        };
      }
      return {
        id: object.id || `road-${index}`,
        axis: "y",
        fixed: ((Number(object.x) + Number(object.width) / 2) / width) * 100,
        start: (Number(object.y) / height) * 100,
        end: ((Number(object.y) + Number(object.height)) / height) * 100,
        points: [],
      };
    });
}

function segmentPoint(segment, value) {
  return segment.axis === "x" ? { x: value, y: segment.fixed } : { x: segment.fixed, y: value };
}

function projectToSegment(point, segment) {
  const value = segment.axis === "x" ? point.x : point.y;
  const clamped = Math.min(segment.end, Math.max(segment.start, value));
  return segmentPoint(segment, clamped);
}

function nearestRoad(point, segments, scale) {
  return segments.reduce((nearest, segment, segmentIndex) => {
    const projected = projectToSegment(point, segment);
    const distance = pointDistance(point, projected, scale);
    if (!nearest || distance < nearest.distance) return { point: projected, segmentIndex, distance };
    return nearest;
  }, null);
}

function nodeKey(point) {
  return `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
}

function addEdge(graph, first, second, scale) {
  const firstKey = nodeKey(first);
  const secondKey = nodeKey(second);
  if (firstKey === secondKey) return;
  if (!graph.has(firstKey)) graph.set(firstKey, { point: first, edges: new Map() });
  if (!graph.has(secondKey)) graph.set(secondKey, { point: second, edges: new Map() });
  const weight = pointDistance(first, second, scale);
  graph.get(firstKey).edges.set(secondKey, weight);
  graph.get(secondKey).edges.set(firstKey, weight);
}

function shortestPath(graph, startKey, endKey) {
  const distances = new Map([[startKey, 0]]);
  const previous = new Map();
  const remaining = new Set(graph.keys());
  while (remaining.size) {
    let current = null;
    remaining.forEach((key) => {
      if (current === null || (distances.get(key) ?? Infinity) < (distances.get(current) ?? Infinity)) current = key;
    });
    if (current === null || !Number.isFinite(distances.get(current))) break;
    remaining.delete(current);
    if (current === endKey) break;
    graph.get(current).edges.forEach((weight, neighbor) => {
      if (!remaining.has(neighbor)) return;
      const candidate = distances.get(current) + weight;
      if (candidate < (distances.get(neighbor) ?? Infinity)) {
        distances.set(neighbor, candidate);
        previous.set(neighbor, current);
      }
    });
  }
  if (!distances.has(endKey)) return [];
  const keys = [];
  for (let key = endKey; key; key = previous.get(key)) {
    keys.push(key);
    if (key === startKey) break;
  }
  return keys.at(-1) === startKey ? keys.reverse().map((key) => graph.get(key).point) : [];
}

export function buildRoadRoute(from, to, map) {
  const segments = roadSegments(map);
  if (segments.length === 0) return [from, to];
  const scale = {
    x: Number(map.world.width) / 100,
    y: Number(map.world.height) / 100,
  };
  const fromRoad = nearestRoad(from, segments, scale);
  const toRoad = nearestRoad(to, segments, scale);
  segments.forEach((segment) => {
    segment.points.push(segmentPoint(segment, segment.start), segmentPoint(segment, segment.end));
  });
  segments[fromRoad.segmentIndex].points.push(fromRoad.point);
  segments[toRoad.segmentIndex].points.push(toRoad.point);

  segments.forEach((first, firstIndex) => {
    segments.slice(firstIndex + 1).forEach((second) => {
      if (first.axis === second.axis) return;
      const horizontal = first.axis === "x" ? first : second;
      const vertical = first.axis === "y" ? first : second;
      if (vertical.fixed < horizontal.start || vertical.fixed > horizontal.end) return;
      if (horizontal.fixed < vertical.start || horizontal.fixed > vertical.end) return;
      const intersection = { x: vertical.fixed, y: horizontal.fixed };
      first.points.push(intersection);
      second.points.push(intersection);
    });
  });

  const graph = new Map();
  segments.forEach((segment) => {
    const ordered = [...new Map(segment.points.map((point) => [nodeKey(point), point])).values()]
      .sort((first, second) => segment.axis === "x" ? first.x - second.x : first.y - second.y);
    ordered.slice(1).forEach((point, index) => addEdge(graph, ordered[index], point, scale));
  });
  const roadPath = shortestPath(graph, nodeKey(fromRoad.point), nodeKey(toRoad.point));
  return roadPath.length ? simplifyPoints([from, ...roadPath, to]) : [from, to];
}

export function buildMovementPlan(previous, current, { minimumDistance = 0.35, roadMap = null } = {}) {
  if (!previous || !current) return [];
  if (Math.abs(Number(current.frameIndex) - Number(previous.frameIndex)) !== 1) return [];
  const previousById = new Map((previous.agents || []).map((agent) => [Number(agent.id), agent]));
  return (current.agents || []).flatMap((agent) => {
    const previousAgent = previousById.get(Number(agent.id));
    const from = previousAgent?.display;
    const to = agent.display;
    if (!from || !to) return [];
    const distance = Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y));
    if (!(distance >= minimumDistance)) return [];
    const fromObjectId = previousAgent.mapObjectId ?? from.mapObjectId ?? null;
    const toObjectId = agent.mapObjectId ?? to.mapObjectId ?? null;
    const useRoad = Boolean(roadMap && fromObjectId && toObjectId && fromObjectId !== toObjectId);
    const points = useRoad ? buildRoadRoute(from, to, roadMap) : [from, to];
    return [{
      id: Number(agent.id),
      from: { x: Number(from.x), y: Number(from.y) },
      to: { x: Number(to.x), y: Number(to.y) },
      distance,
      points,
      routeMode: useRoad && points.length > 2 ? "road" : "direct",
      direction: movementDirection(points[0], points[1]),
    }];
  });
}

export function movementPoint(movement, progress) {
  const amount = Math.min(1, Math.max(0, Number(progress)));
  const points = movement.points?.length > 1 ? movement.points : [movement.from, movement.to];
  const lengths = points.slice(1).map((point, index) => pointDistance(points[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!(total > 0)) return { ...points.at(-1) };
  let remaining = total * amount;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const local = lengths[index] > 0 ? Math.min(1, remaining / lengths[index]) : 1;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * local,
        y: points[index].y + (points[index + 1].y - points[index].y) * local,
      };
    }
    remaining -= lengths[index];
  }
  return { ...points.at(-1) };
}

export function movementDirectionAt(movement, progress) {
  const amount = Math.min(0.999999, Math.max(0, Number(progress)));
  const here = movementPoint(movement, amount);
  const ahead = movementPoint(movement, Math.min(1, amount + 0.002));
  return movementDirection(here, ahead);
}

export function movementKeyframes(movement) {
  const points = movement.points?.length > 1 ? movement.points : [movement.from, movement.to];
  const lengths = points.slice(1).map((point, index) => pointDistance(points[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  let traveled = 0;
  return points.map((point, index) => {
    if (index > 0) traveled += lengths[index - 1];
    return { left: `${point.x}%`, top: `${point.y}%`, offset: index === points.length - 1 ? 1 : traveled / total };
  });
}

export function movementPath(movement) {
  const points = movement.points?.length > 1 ? movement.points : [movement.from, movement.to];
  if (movement.routeMode === "road" && points.length > 2) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(" ");
  }
  const dx = movement.to.x - movement.from.x;
  const dy = movement.to.y - movement.from.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const bend = Math.min(3.2, distance * 0.12) * (movement.id % 2 === 0 ? 1 : -1);
  const controlX = (movement.from.x + movement.to.x) / 2 - (dy / distance) * bend;
  const controlY = (movement.from.y + movement.to.y) / 2 + (dx / distance) * bend;
  return `M ${movement.from.x.toFixed(3)} ${movement.from.y.toFixed(3)} Q ${controlX.toFixed(3)} ${controlY.toFixed(3)} ${movement.to.x.toFixed(3)} ${movement.to.y.toFixed(3)}`;
}
