import {
  ASSET_CATALOG_URL,
  DEFAULT_MAP_URL,
  MAP_DRAFT_KEY,
  loadAssetCatalog,
  loadMap,
  mappedObjectForBuilding,
  renderMap,
  renderMapError,
  validateMap,
} from "./map-renderer.js?v=20260720-timeline-guide";
import { buildReplayLayout } from "./agent-layout.js?v=20260720-timeline-guide";
import { buildAgentAppearance } from "./agent-appearance.js?v=20260720-timeline-guide";
import { applyCharacterSpriteStyle, readCharacterRoster } from "./character-sprites.js?v=20260720-timeline-guide";
import {
  MOVEMENT_MODE_KEY,
  ROAD_MOVEMENT_KEY,
  buildMovementPlan,
  movementDirectionAt,
  movementKeyframes,
  movementPath,
  movementPoint,
  normalizeMovementMode,
} from "./agent-movement.js?v=20260720-timeline-guide";
import { bindLanguageControls, initI18n, t } from "./i18n.js?v=20260720-timeline-guide";
import {
  activeDialogueEntries,
  buildEncounterGroups,
  groupTurnCount,
  playbackDuration,
  turnDurationFromFrameDelay,
} from "./encounter-playback.js?v=20260720-timeline-guide";
import {
  RELATIONSHIP_METRICS,
  buildRelationshipDashboard,
  linePath,
  relationshipPulse,
} from "./relationship-dashboard.js?v=20260720-timeline-guide";
import {
  LOOP_PAUSE_MS,
  buildTimelineMarkers,
  createPlaybackWindow,
  samplePlaybackWindow,
} from "./timeline-playback.js?v=20260720-timeline-guide";

initI18n();
bindLanguageControls();

const dom = {
  runName: document.querySelector("#run-name"),
  agentCount: document.querySelector("#agent-count"),
  sceneName: document.querySelector("#scene-name"),
  bubbleDemoButton: document.querySelector("#bubble-demo-button"),
  bubbleDemoLabel: document.querySelector("#bubble-demo-label"),
  movementMode: document.querySelector("#movement-mode"),
  roadMovementButton: document.querySelector("#road-movement-button"),
  movementLayer: document.querySelector("#movement-layer"),
  movementTrails: document.querySelector("#movement-trails"),
  movementGhosts: document.querySelector("#movement-ghosts"),
  stepLabel: document.querySelector("#step-label"),
  timeLabel: document.querySelector("#time-label"),
  eventCount: document.querySelector("#event-count"),
  world: document.querySelector("#world"),
  mapLayer: document.querySelector("#map-layer"),
  agentLayer: document.querySelector("#agent-layer"),
  relationLayer: document.querySelector("#relation-layer"),
  timeline: document.querySelector("#timeline"),
  timelineTicks: document.querySelector("#timeline-ticks"),
  timelineEvents: document.querySelector("#timeline-events"),
  timelinePosition: document.querySelector("#timeline-position"),
  timelineTitle: document.querySelector("#timeline-title"),
  playButton: document.querySelector("#play-button"),
  speedSelect: document.querySelector("#speed-select"),
  dataFile: document.querySelector("#data-file"),
  guideButton: document.querySelector("#guide-button"),
  usageGuide: document.querySelector("#usage-guide"),
  focusEmpty: document.querySelector("#focus-empty"),
  focusContent: document.querySelector("#focus-content"),
  focusAvatar: document.querySelector("#focus-avatar"),
  focusName: document.querySelector("#focus-name"),
  focusRole: document.querySelector("#focus-role"),
  focusId: document.querySelector("#focus-id"),
  focusState: document.querySelector("#focus-state"),
  focusPlace: document.querySelector("#focus-place"),
  profileGrid: document.querySelector("#profile-grid"),
  clearFocus: document.querySelector("#clear-focus"),
  dashboardSummary: document.querySelector("#dashboard-summary"),
  dashboardOverviewButton: document.querySelector("#dashboard-overview-button"),
  dashboardIndividualButton: document.querySelector("#dashboard-individual-button"),
  dashboardAgentName: document.querySelector("#dashboard-agent-name"),
  dashboardStage: document.querySelector("#dashboard-stage"),
  relationshipChart: document.querySelector("#relationship-chart"),
  dashboardMetrics: document.querySelector("#dashboard-metrics"),
  relationshipRoster: document.querySelector("#relationship-roster"),
  eventList: document.querySelector("#event-list"),
  dataSource: document.querySelector("#data-source"),
  toast: document.querySelector("#toast"),
};

const state = {
  data: null,
  map: null,
  mapRenderer: null,
  replayLayout: null,
  relationshipDashboard: null,
  dashboardMode: "overview",
  dashboardAgentId: null,
  relationPulseStep: null,
  relationPulseStartedAt: 0,
  frameIndex: 0,
  focusedAgentId: null,
  playing: false,
  timer: null,
  playbackRaf: null,
  playbackPauseTimer: null,
  playbackWindow: null,
  timelineCursor: 0,
  activeTransition: null,
  bubbleDemoEnabled: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  bubblePage: 0,
  bubbleTurn: 0,
  bubbleStep: null,
  bubbleTimer: null,
  movementMode: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "off"
    : normalizeMovementMode(window.localStorage.getItem(MOVEMENT_MODE_KEY)),
  roadMovement: window.localStorage.getItem(ROAD_MOVEMENT_KEY) === "true",
  lastMovementSnapshot: null,
  movementTimer: null,
  movementSpriteTimers: [],
  movementAnimations: [],
};

const MOVEMENT_DURATION_MS = 900;

dom.movementMode.value = state.movementMode;

function updateRoadMovementControl() {
  dom.roadMovementButton.classList.toggle("is-active", state.roadMovement);
  dom.roadMovementButton.setAttribute("aria-pressed", String(state.roadMovement));
}

updateRoadMovementControl();

const toneLabel = (tone) => t(`viewer.tone.${tone}`, {}, tone);

const toneColors = {
  mutual: "#f6c74f",
  approach: "#e75f51",
  safety: "#4b5475",
  neutral: "#777363",
};

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !["{", "["].includes(text[0])) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function normalizeData(raw) {
  if (!raw || !Array.isArray(raw.agents) || !Array.isArray(raw.frames)) {
    throw new Error(t("viewer.invalidReplay"));
  }
  if (raw.frames.length === 0) throw new Error(t("viewer.emptyFrames"));

  const rosterById = new Map(readCharacterRoster().map((character) => [String(character.id), character]));
  const agents = raw.agents.map((agent, index) => {
    const profile = parseMaybeJson(agent.profile) || {};
    const rosterAppearance = rosterById.get(String(agent.id))?.appearance;
    return {
      id: Number(agent.id),
      name: String(agent.name || `Agent ${agent.id ?? index + 1}`),
      role: String(agent.role || profile.role || "participant"),
      profile,
      appearance: buildAgentAppearance(agent, profile, rosterAppearance || agent.appearance),
    };
  });
  const knownIds = new Set(agents.map((agent) => agent.id));
  const coordinateSystem = raw.meta?.coordinateSystem || {
    type: "normalized",
    unit: "normalized",
    origin: "top_left",
    width: 100,
    height: 100,
  };
  const coordinateWidth = Number(coordinateSystem.site_width_m ?? coordinateSystem.width ?? 100);
  const coordinateHeight = Number(coordinateSystem.site_height_m ?? coordinateSystem.height ?? 100);

  const frames = raw.frames
    .map((frame, index) => ({
      step: Number(frame.step ?? index),
      time: String(frame.time || frame.t || `Step ${frame.step ?? index}`),
      agents: (frame.agents || [])
        .filter((item) => knownIds.has(Number(item.id ?? item.agent_id)))
        .map((item) => ({
          ...item,
          id: Number(item.id ?? item.agent_id),
          x: clamp(Number(item.x ?? coordinateWidth / 2), 0, coordinateWidth),
          y: clamp(Number(item.y ?? coordinateHeight / 2), 0, coordinateHeight),
          state: String(item.state || item.status || "observing"),
          place: String(item.place || item.aoi_name || ""),
        })),
    }))
    .sort((a, b) => a.step - b.step);

  const events = (raw.events || [])
    .map((event, index) => ({
      ...event,
      id: String(event.id ?? `event-${index + 1}`),
      step: Number(event.step ?? 0),
      time: String(event.time || event.t || ""),
      source: event.source == null ? null : Number(event.source),
      target: event.target == null ? null : Number(event.target),
      type: String(event.type || "interaction"),
      content: String(event.content || event.message || event.type || t("viewer.interactionFallback")),
      place: String(event.place || ""),
      tone: ["mutual", "approach", "safety"].includes(event.tone)
        ? event.tone
        : "neutral",
    }))
    .sort((a, b) => a.step - b.step);

  return {
    meta: {
      title: String(raw.meta?.title || "AgentSociety Replay"),
      scene: String(raw.meta?.scene || "Urban social setting"),
      source: String(raw.meta?.source || "Normalized replay JSON"),
      description: String(raw.meta?.description || ""),
      coordinateSystem: {
        ...coordinateSystem,
        width: coordinateWidth,
        height: coordinateHeight,
      },
      spatial: raw.meta?.spatial || null,
    },
    agents,
    frames,
    events,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function currentFrame() {
  return state.data.frames[state.frameIndex];
}

function agentById(id) {
  return state.data.agents.find((agent) => agent.id === Number(id));
}

function frameAgentById(id) {
  return currentFrame().agents.find((agent) => agent.id === Number(id));
}

function eventsAtStep(step) {
  return state.data.events.filter((event) => event.step === step);
}

function clearBubbleRotation() {
  window.clearTimeout(state.bubbleTimer);
  state.bubbleTimer = null;
}

function bubbleDemoState(frame, currentEvents) {
  if (state.bubbleStep !== frame.step) {
    state.bubbleStep = frame.step;
    state.bubblePage = 0;
    state.bubbleTurn = 0;
  }
  const groups = buildEncounterGroups(currentEvents, frame);
  state.bubblePage %= groups.length;
  const activeGroup = groups[state.bubblePage];
  const turnCount = groupTurnCount(activeGroup);
  state.bubbleTurn %= turnCount;
  const activeEntries = state.bubbleDemoEnabled ? activeDialogueEntries(activeGroup, state.bubbleTurn) : [];
  const activeDialogueByAgent = new Map(activeEntries.map((entry) => [entry.anchorId, entry]));
  dom.world.classList.toggle("is-bubble-demo", state.bubbleDemoEnabled);
  dom.bubbleDemoButton.hidden = currentEvents.length === 0;
  dom.bubbleDemoButton.classList.toggle("is-active", state.bubbleDemoEnabled);
  dom.bubbleDemoButton.setAttribute("aria-pressed", String(state.bubbleDemoEnabled));
  dom.bubbleDemoLabel.textContent = state.bubbleDemoEnabled
    ? t("viewer.bubblesPage", {
      page: state.bubblePage + 1,
      total: groups.length,
      turn: state.bubbleTurn + 1,
      turns: turnCount,
    })
    : t("viewer.bubblesOff");
  return { groups, activeDialogueByAgent };
}

function scheduleBubbleRotation(frameStep, groups) {
  clearBubbleRotation();
  if (!state.bubbleDemoEnabled || !groups.some((group) => group.length) || document.hidden) return;
  const turnDuration = turnDurationFromFrameDelay(dom.speedSelect.value);
  state.bubbleTimer = window.setTimeout(() => {
    if (!state.data || currentFrame().step !== frameStep) return;
    const activeGroup = groups[state.bubblePage % groups.length];
    const turnCount = groupTurnCount(activeGroup);
    if (state.bubbleTurn + 1 < turnCount) {
      state.bubbleTurn += 1;
    } else {
      state.bubbleTurn = 0;
      state.bubblePage = (state.bubblePage + 1) % groups.length;
    }
    render();
  }, turnDuration);
}

function projectAgentPosition(frameAgent) {
  const coordinateSystem = state.data.meta.coordinateSystem;
  const sourceWidth = Number(coordinateSystem.width || 100);
  const sourceHeight = Number(coordinateSystem.height || 100);
  const fallback = {
    x: clamp((frameAgent.x / sourceWidth) * 100, 3, 97),
    y: clamp((frameAgent.y / sourceHeight) * 100, 3, 97),
    mapObjectId: null,
    projection: "global",
  };
  if (!state.map || !frameAgent.buildingId) return fallback;

  const target = mappedObjectForBuilding(state.map, frameAgent.buildingId);
  const sourceBounds = state.data.meta.spatial?.buildings?.[frameAgent.buildingId]?.bounds;
  if (!target || !sourceBounds || !(Number(sourceBounds.width) > 0) || !(Number(sourceBounds.height) > 0)) {
    return fallback;
  }

  const localX = clamp((frameAgent.x - Number(sourceBounds.x)) / Number(sourceBounds.width), 0, 1);
  const localY = clamp((frameAgent.y - Number(sourceBounds.y)) / Number(sourceBounds.height), 0, 1);
  const paddingX = Math.min(4, Number(target.width) * 0.08);
  const paddingY = Math.min(4, Number(target.height) * 0.08);
  const usableWidth = Math.max(1, Number(target.width) - paddingX * 2);
  const usableHeight = Math.max(1, Number(target.height) - paddingY * 2);
  const targetX = Number(target.x) + paddingX + localX * usableWidth;
  const targetY = Number(target.y) + paddingY + localY * usableHeight;
  return {
    x: clamp((targetX / state.map.world.width) * 100, 1, 99),
    y: clamp((targetY / state.map.world.height) * 100, 1, 99),
    mapObjectId: target.id,
    projection: "building",
  };
}

function projectFrame(frame) {
  return {
    ...frame,
    agents: frame.agents.map((agent) => ({ ...agent, display: projectAgentPosition(agent) })),
  };
}

function rebuildReplayLayout() {
  state.replayLayout = null;
  if (!state.data || !state.map) return;
  try {
    state.replayLayout = buildReplayLayout({
      frames: state.data.frames.map(projectFrame),
      events: state.data.events,
      map: state.map,
      seed: `${state.map.id}:${state.data.meta.title}:${state.data.meta.source}`,
    });
  } catch (error) {
    console.warn("Agent layout fallback:", error);
  }
}

function applyReplayLayout(frame) {
  const frameLayout = state.replayLayout?.byStep.get(String(frame.step));
  if (!frameLayout) return { frame, conversations: [] };
  return {
    frame: {
      ...frame,
      agents: frame.agents.map((agent) => {
        const layout = frameLayout.positions.get(Number(agent.id));
        if (!layout) return agent;
        return {
          ...agent,
          display: {
            ...agent.display,
            x: layout.x,
            y: layout.y,
            scale: layout.scale,
            conversationId: layout.conversationId,
            conversationTone: layout.conversationTone,
          },
        };
      }),
    },
    conversations: frameLayout.conversations,
  };
}

function movementSnapshot(frame, frameIndex = state.frameIndex) {
  return {
    frameIndex,
    agents: frame.agents.map((agent) => ({
      id: Number(agent.id),
      display: { x: Number(agent.display.x), y: Number(agent.display.y) },
      mapObjectId: agent.display.mapObjectId || null,
    })),
  };
}

function clearMovementEffects() {
  window.clearTimeout(state.movementTimer);
  state.movementTimer = null;
  state.movementSpriteTimers.forEach((timer) => {
    window.clearInterval(timer);
    window.clearTimeout(timer);
  });
  state.movementSpriteTimers = [];
  state.movementAnimations.forEach((animation) => animation.cancel());
  state.movementAnimations = [];
  dom.movementTrails.replaceChildren();
  dom.movementGhosts.replaceChildren();
  dom.movementLayer.className = "movement-layer";
}

function movementColor(agentId) {
  return ["#f6c74f", "#70c3cf", "#ec765f", "#a7cc70"][Math.abs(Number(agentId)) % 4];
}

function appendMovementPath(movement, className) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", movementPath(movement));
  path.setAttribute("pathLength", "1");
  path.setAttribute("class", className);
  path.style.setProperty("--movement-color", movementColor(movement.id));
  path.dataset.agentId = String(movement.id);
  path.dataset.routeMode = movement.routeMode;
  dom.movementTrails.append(path);
}

function renderLightTrails(plan) {
  plan.forEach((movement) => {
    appendMovementPath(movement, "movement-light-halo");
    appendMovementPath(movement, "movement-light-core");
    const endpoint = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    endpoint.setAttribute("cx", movement.to.x);
    endpoint.setAttribute("cy", movement.to.y);
    endpoint.setAttribute("r", "0.72");
    endpoint.setAttribute("class", "movement-endpoint");
    endpoint.style.setProperty("--movement-color", movementColor(movement.id));
    dom.movementTrails.append(endpoint);
  });
}

function renderMovementGhosts(plan, duration = MOVEMENT_DURATION_MS) {
  plan.forEach((movement) => {
    const profile = agentById(movement.id);
    if (!profile) return;
    [0.2, 0.43, 0.67].forEach((progress, index) => {
      const point = movementPoint(movement, progress);
      const ghost = document.createElement("span");
      ghost.className = "movement-ghost";
      ghost.style.left = `${point.x}%`;
      ghost.style.top = `${point.y}%`;
      // A residual image must only appear after the moving Agent has passed it.
      ghost.style.setProperty("--ghost-delay", `${Math.round(progress * duration)}ms`);
      ghost.style.setProperty("--movement-color", movementColor(movement.id));
      ghost.dataset.agentId = String(movement.id);
      ghost.dataset.routeMode = movement.routeMode;
      ghost.dataset.progress = String(progress);
      applyCharacterSpriteStyle(ghost, {
        ...profile.appearance,
        direction: movementDirectionAt(movement, progress),
        frame: index,
      });
      dom.movementGhosts.append(ghost);
    });
  });
}

function renderMovementEffects(plan, duration = MOVEMENT_DURATION_MS) {
  clearMovementEffects();
  if (plan.length === 0 || ["off", "normal"].includes(state.movementMode)) return;
  dom.movementLayer.classList.add(`mode-${state.movementMode}`, "is-active");
  dom.movementLayer.classList.toggle("is-dense-flow", plan.length > 12);
  if (state.movementMode === "ghost") renderMovementGhosts(plan, duration);
  else renderLightTrails(plan);
  state.movementTimer = window.setTimeout(clearMovementEffects, duration + 260);
}

function animateAgentButtons(movingAgents, duration = MOVEMENT_DURATION_MS) {
  if (movingAgents.length === 0) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    movingAgents.forEach(({ button, sprite, movement, appearance }) => {
      if (!button.isConnected) return;
      button.classList.add("is-moving");
      button.style.left = `${movement.to.x}%`;
      button.style.top = `${movement.to.y}%`;
      const animation = button.animate(movementKeyframes(movement), {
        duration,
        easing: movement.routeMode === "road" ? "linear" : "cubic-bezier(0.2, 0.72, 0.26, 1)",
      });
      state.movementAnimations.push(animation);
      const startedAt = performance.now();
      let frame = 0;
      const frameTimer = window.setInterval(() => {
        if (!sprite.isConnected) {
          window.clearInterval(frameTimer);
          return;
        }
        applyCharacterSpriteStyle(sprite, {
          ...appearance,
          direction: movementDirectionAt(movement, (performance.now() - startedAt) / duration),
          frame: frame % 3,
        });
        frame += 1;
      }, 150);
      const stopTimer = window.setTimeout(() => {
        window.clearInterval(frameTimer);
        if (sprite.isConnected) applyCharacterSpriteStyle(sprite, appearance);
        button.classList.remove("is-moving");
      }, duration);
      state.movementSpriteTimers.push(frameTimer, stopTimer);
    });
  }));
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function percentage(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(clamp(number, 0, 1) * 100) : null;
}

function relationshipStageLabel(stage) {
  return t(`viewer.stage.${stage}`, {}, String(stage || t("viewer.stage.unknown")));
}

function evidenceStatusLabel(status) {
  return t(`viewer.evidence.${status}`, {}, String(status || ""));
}

function buildProgressRibbon(event) {
  const fragment = document.createDocumentFragment();
  const progress = event.relationshipProgress;
  if (!progress) return fragment;
  const ribbon = document.createElement("span");
  ribbon.className = "progress-ribbon";
  const heading = document.createElement("span");
  heading.className = "progress-stage";
  heading.textContent = relationshipStageLabel(progress.stage);
  ribbon.append(heading);

  const metrics = document.createElement("span");
  metrics.className = "progress-metrics";
  const definitions = [
    ["FAM", progress.metrics?.familiarity],
    ["TRUST", progress.metrics?.trust],
    ["ATTR", progress.metrics?.mutualAttraction],
  ];
  definitions.forEach(([label, value]) => {
    const percent = percentage(value);
    const metric = document.createElement("span");
    metric.className = "progress-metric";
    const name = document.createElement("b");
    name.textContent = label;
    const rail = document.createElement("i");
    rail.style.setProperty("--metric-value", `${percent ?? 0}%`);
    const output = document.createElement("em");
    output.textContent = percent === null ? "—" : String(percent);
    metric.append(name, rail, output);
    metrics.append(metric);
  });
  metrics.title = t("viewer.attrDirections", {
    source: percentage(progress.metrics?.attractionSourceToTarget) ?? "—",
    target: percentage(progress.metrics?.attractionTargetToSource) ?? "—",
  });
  ribbon.append(metrics);

  const badges = document.createElement("span");
  badges.className = "progress-badges";
  [
    ["secondMeeting", "viewer.milestone.meeting"],
    ["contactExchange", "viewer.milestone.contact"],
  ].forEach(([key, labelKey]) => {
    const milestone = progress.milestones?.[key];
    if (!milestone || milestone.status === "not_claimed") return;
    const badge = document.createElement("span");
    badge.className = `progress-badge status-${milestone.status}`;
    badge.dataset.status = milestone.status;
    badge.textContent = t(labelKey);
    badge.title = evidenceStatusLabel(milestone.status);
    badges.append(badge);
  });
  if (badges.childElementCount) ribbon.append(badges);
  fragment.append(ribbon);
  return fragment;
}

function buildEventAudit(event) {
  const fragment = document.createDocumentFragment();
  if (!event.relationshipProgress) return fragment;
  const audit = document.createElement("span");
  audit.className = "event-audit";
  const stage = document.createElement("span");
  stage.className = "event-stage";
  stage.textContent = relationshipStageLabel(event.relationshipProgress.stage);
  audit.append(stage);
  (event.dataQualityIssues || []).forEach((issue) => {
    const warning = document.createElement("span");
    warning.className = "event-warning";
    warning.textContent = t(`viewer.issue.${issue.code}`, {}, issue.code);
    audit.append(warning);
  });
  fragment.append(audit);
  return fragment;
}

function dashboardSeries(agentId) {
  return state.relationshipDashboard?.byAgent.get(Number(agentId)) || [];
}

function dashboardSeriesIndex(series) {
  return series.findIndex((point) => point.step === currentFrame().step);
}

function createSvgElement(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function renderRelationshipChart(series) {
  dom.relationshipChart.replaceChildren();
  dom.relationshipChart.dataset.hasData = String(series.some((point) => point.dyadCount > 0));
  [18, 50, 82].forEach((y) => {
    const line = createSvgElement("line");
    line.setAttribute("x1", "10");
    line.setAttribute("x2", "236");
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", "relationship-grid-line");
    dom.relationshipChart.append(line);
  });
  RELATIONSHIP_METRICS.forEach(([metric]) => {
    const pathData = linePath(series, metric, 246, 104, 10);
    if (!pathData) return;
    const path = createSvgElement("path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", `relationship-line ${metric}`);
    path.setAttribute("fill", "none");
    dom.relationshipChart.append(path);
  });
  const index = dashboardSeriesIndex(series);
  if (index < 0) return;
  const x = 10 + (series.length <= 1 ? 0.5 : index / (series.length - 1)) * 226;
  const marker = createSvgElement("line");
  marker.setAttribute("x1", String(x));
  marker.setAttribute("x2", String(x));
  marker.setAttribute("y1", "8");
  marker.setAttribute("y2", "96");
  marker.setAttribute("class", "relationship-now-line");
  dom.relationshipChart.append(marker);
}

function renderDashboardMetrics(point) {
  dom.dashboardMetrics.replaceChildren();
  RELATIONSHIP_METRICS.forEach(([metric, label]) => {
    const value = percentage(point?.metrics?.[metric]);
    const metricElement = document.createElement("div");
    metricElement.className = `dashboard-gauge ${metric}`;
    metricElement.style.setProperty("--gauge-value", `${Math.round((point?.metrics?.[metric] || 0) * 180)}deg`);
    metricElement.dataset.hasData = String(value !== null);
    const dial = document.createElement("span");
    dial.className = "dashboard-gauge-dial";
    const name = document.createElement("b");
    name.textContent = label;
    const valueElement = document.createElement("em");
    valueElement.textContent = value === null ? "—" : `${value}%`;
    dial.append(name, valueElement);
    metricElement.append(dial);
    dom.dashboardMetrics.append(metricElement);
  });
}

function renderRelationshipRoster(currentAgentId) {
  dom.relationshipRoster.replaceChildren();
  state.data.agents.forEach((agent) => {
    const series = dashboardSeries(agent.id);
    const point = series[dashboardSeriesIndex(series)] || series[series.length - 1];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "relationship-agent-card";
    card.dataset.agentId = String(agent.id);
    if (Number(agent.id) === Number(currentAgentId)) card.classList.add("is-selected");
    const name = document.createElement("strong");
    name.textContent = agent.name;
    const stage = document.createElement("span");
    stage.className = "roster-stage";
    stage.textContent = point?.dyadCount ? relationshipStageLabel(point.stage) : t("viewer.dashboardNoDyad");
    const trend = createSvgElement("svg");
    trend.classList.add("roster-sparkline");
    trend.setAttribute("viewBox", "0 0 54 16");
    trend.setAttribute("preserveAspectRatio", "none");
    const sparkPath = linePath(series, "mutualAttraction", 54, 16, 2);
    if (sparkPath) {
      const path = createSvgElement("path");
      path.setAttribute("d", sparkPath);
      path.setAttribute("class", "roster-sparkline-path");
      path.setAttribute("fill", "none");
      trend.append(path);
    }
    const values = document.createElement("span");
    values.className = "roster-values";
    values.textContent = RELATIONSHIP_METRICS.map(([metric, label]) => `${label[0]}${percentage(point?.metrics?.[metric]) ?? "—"}`).join(" ");
    card.append(name, stage, trend, values);
    card.addEventListener("click", () => {
      state.dashboardMode = "individual";
      state.dashboardAgentId = agent.id;
      state.focusedAgentId = agent.id;
      render();
    });
    dom.relationshipRoster.append(card);
  });
}

function renderRelationshipDashboard() {
  if (!state.relationshipDashboard) return;
  const overviewMode = state.dashboardMode === "overview";
  const selectedId = state.focusedAgentId ?? state.dashboardAgentId ?? state.data.agents[0]?.id;
  const selectedAgent = agentById(selectedId) || state.data.agents[0];
  if (!selectedAgent && !overviewMode) return;
  state.dashboardAgentId = selectedAgent.id;
  const series = overviewMode ? state.relationshipDashboard.overview : dashboardSeries(selectedAgent.id);
  const point = series[dashboardSeriesIndex(series)] || series[series.length - 1];
  const dyadCount = point?.dyadCount || 0;
  const dashboardRoot = dom.dashboardSummary.closest(".relationship-dashboard");
  dashboardRoot.dataset.dashboardMode = state.dashboardMode;
  dom.dashboardOverviewButton.setAttribute("aria-pressed", String(overviewMode));
  dom.dashboardIndividualButton.setAttribute("aria-pressed", String(!overviewMode));
  dom.dashboardSummary.textContent = t("viewer.dashboardSummary", {
    agents: state.data.agents.length,
    dyads: dyadCount,
  });
  dom.dashboardAgentName.textContent = overviewMode ? t("viewer.dashboardDistrict") : selectedAgent.name;
  dom.dashboardStage.textContent = overviewMode
    ? t("viewer.dashboardActiveAgents", { agents: point?.activeAgentCount || 0 })
    : (point?.dyadCount ? relationshipStageLabel(point.stage) : t("viewer.dashboardNoDyad"));
  renderRelationshipChart(series);
  renderDashboardMetrics(point);
  renderRelationshipRoster(selectedAgent.id);
}

function relationshipPulseForAgent(agentId) {
  const elapsed = performance.now() - state.relationPulseStartedAt;
  if (elapsed > 2400 || state.frameIndex === 0) return null;
  const series = dashboardSeries(agentId);
  const index = dashboardSeriesIndex(series);
  return index > 0 ? relationshipPulse(series, index) : null;
}

function displayLayoutForFrame(frame) {
  return applyReplayLayout(projectFrame(frame));
}

function render() {
  if (!state.data) return;
  const frame = currentFrame();
  const displayLayout = displayLayoutForFrame(frame);
  const currentEvents = eventsAtStep(frame.step);
  if (state.relationPulseStep !== frame.step) {
    state.relationPulseStep = frame.step;
    state.relationPulseStartedAt = performance.now();
  }
  const currentMovementSnapshot = movementSnapshot(displayLayout.frame);
  let agentLayout = displayLayout;
  let movementPlan = state.movementMode === "off"
    ? []
    : buildMovementPlan(state.lastMovementSnapshot, currentMovementSnapshot, {
      roadMap: state.roadMovement ? state.map : null,
    });
  let movementDuration = MOVEMENT_DURATION_MS;
  if (state.activeTransition) {
    const targetFrame = state.data.frames[state.activeTransition.targetIndex];
    if (targetFrame) {
      agentLayout = displayLayoutForFrame(targetFrame);
      const targetSnapshot = movementSnapshot(agentLayout.frame, state.activeTransition.targetIndex);
      movementPlan = state.movementMode === "off"
        ? []
        : buildMovementPlan(currentMovementSnapshot, targetSnapshot, {
          roadMap: state.roadMovement ? state.map : null,
        });
      movementDuration = state.activeTransition.duration;
    }
  }
  const bubbleState = bubbleDemoState(displayLayout.frame, currentEvents);
  const cursor = Number.isFinite(state.timelineCursor) ? state.timelineCursor : state.frameIndex;
  const progress = state.data.frames.length <= 1
    ? 0
    : (cursor / (state.data.frames.length - 1)) * 100;

  dom.runName.textContent = state.data.meta.title;
  dom.agentCount.textContent = t("viewer.agentCount", { count: state.data.agents.length });
  dom.sceneName.textContent = state.data.meta.scene;
  dom.stepLabel.textContent = t("viewer.step", { step: String(frame.step).padStart(2, "0") });
  dom.timeLabel.textContent = frame.time;
  dom.eventCount.textContent = t(currentEvents.length === 1 ? "viewer.eventCount.one" : "viewer.eventCount.other", { count: currentEvents.length });
  dom.timelinePosition.textContent = `${state.frameIndex + 1} / ${state.data.frames.length}`;
  dom.timelineTitle.textContent = state.data.meta.description || t("viewer.observationWindow");
  dom.timeline.value = String(cursor);
  dom.timeline.style.setProperty("--timeline-progress", `${progress}%`);
  dom.dataSource.textContent = state.data.meta.source;

  renderRelationshipDashboard();
  renderMovementEffects(movementPlan, movementDuration);
  renderAgents(
    agentLayout.frame,
    state.activeTransition ? [] : currentEvents,
    state.activeTransition ? new Map() : bubbleState.activeDialogueByAgent,
    movementPlan,
    movementDuration,
  );
  renderRelations(
    state.activeTransition ? agentLayout.frame : displayLayout.frame,
    state.activeTransition ? [] : currentEvents,
    state.activeTransition ? [] : displayLayout.conversations,
  );
  renderFocus();
  renderEventList(frame);
  if (!state.activeTransition) scheduleBubbleRotation(frame.step, bubbleState.groups);
  if (!state.activeTransition) state.lastMovementSnapshot = currentMovementSnapshot;
}

function renderAgents(frame, currentEvents, activeDialogueByAgent = new Map(), movementPlan = [], movementDuration = MOVEMENT_DURATION_MS) {
  dom.agentLayer.replaceChildren();
  const movementById = new Map(movementPlan.map((movement) => [Number(movement.id), movement]));
  const movingAgents = [];
  frame.agents.forEach((frameAgent) => {
    const profile = agentById(frameAgent.id);
    if (!profile) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "agent";
    button.dataset.agentId = String(profile.id);
    button.setAttribute("aria-label", t("viewer.viewAgent", { name: profile.name }));
    const movement = movementById.get(Number(profile.id));
    button.style.left = `${movement?.from.x ?? frameAgent.display.x}%`;
    button.style.top = `${movement?.from.y ?? frameAgent.display.y}%`;
    button.style.setProperty("--agent-scale", String(frameAgent.display.scale || 1));
    button.dataset.projection = frameAgent.display.projection;
    if (frameAgent.display.mapObjectId) button.dataset.mapObjectId = frameAgent.display.mapObjectId;
    button.dataset.gender = profile.appearance.gender;
    button.dataset.spriteId = profile.appearance.spriteId;
    button.classList.add(`gender-${profile.appearance.gender}`, profile.appearance.spriteId);
    if (frameAgent.display.conversationId) {
      button.classList.add("is-conversing");
      button.dataset.conversationId = frameAgent.display.conversationId;
      button.style.setProperty("--conversation-color", toneColors[frameAgent.display.conversationTone] || toneColors.neutral);
    }
    if (activeDialogueByAgent.has(profile.id)) {
      button.classList.add("is-demo-speaking");
      button.style.setProperty("--bubble-delay", `${activeDialogueByAgent.get(profile.id).slot * 90}ms`);
    }
    if (frameAgent.display.x > 58) button.classList.add("bubble-align-left");
    if (frameAgent.display.y < 36) button.classList.add("bubble-align-below");
    if (state.focusedAgentId === profile.id) button.classList.add("is-focused");

    const shadow = document.createElement("span");
    shadow.className = "agent-shadow";
    const sprite = document.createElement("span");
    sprite.className = "agent-sprite";
    applyCharacterSpriteStyle(sprite, movement
      ? { ...profile.appearance, direction: movement.direction, frame: 0 }
      : profile.appearance);
    const label = document.createElement("span");
    label.className = "agent-name";
    label.textContent = profile.name;
    button.append(shadow, sprite, label);

    const pulse = relationshipPulseForAgent(profile.id);
    if (pulse) {
      const marker = document.createElement("span");
      marker.className = `relationship-state-bubble is-${pulse.tone}`;
      marker.dataset.kind = pulse.kind;
      marker.style.setProperty("--pulse-age", `-${Math.round(performance.now() - state.relationPulseStartedAt)}ms`);
      marker.textContent = pulse.symbol;
      marker.title = t(`viewer.pulse.${pulse.kind}`, {}, pulse.kind);
      marker.setAttribute("aria-label", marker.title);
      button.append(marker);
    }

    const dialogue = activeDialogueByAgent.get(profile.id);
    if (dialogue) {
      const { event, turn } = dialogue;
      const bubble = document.createElement("span");
      bubble.className = `speech-bubble speaker-${turn.speakerRole}`;
      bubble.dataset.eventId = event.id;
      bubble.dataset.turnIndex = String(turn.index);
      bubble.dataset.speakerRole = turn.speakerRole;
      const speaker = document.createElement("strong");
      speaker.className = "speech-speaker";
      speaker.textContent = turn.speakerRole === "npc"
        ? t("viewer.speaker.npc")
        : turn.speakerRole === "self"
          ? t("viewer.speaker.self", { name: profile.name })
          : profile.name;
      const content = document.createElement("span");
      content.className = "speech-content";
      content.textContent = turn.text;
      bubble.append(speaker, content, buildProgressRibbon(event));
      button.append(bubble);
    }

    button.addEventListener("click", () => {
      state.dashboardMode = "individual";
      state.focusedAgentId = profile.id;
      state.dashboardAgentId = profile.id;
      render();
    });
    dom.agentLayer.append(button);
    if (movement) movingAgents.push({ button, sprite, movement, appearance: profile.appearance });
  });
  animateAgentButtons(movingAgents, movementDuration);
}

function appendRelationLine(source, target, className) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", source.display.x);
  line.setAttribute("y1", source.display.y);
  line.setAttribute("x2", target.display.x);
  line.setAttribute("y2", target.display.y);
  line.setAttribute("class", className);
  dom.relationLayer.append(line);
  return line;
}

function appendConversationOutline(source, target, conversation) {
  const horizontalPadding = 2.35;
  const topPadding = 5.2;
  const bottomPadding = 1.25;
  const left = clamp(Math.min(source.display.x, target.display.x) - horizontalPadding, 0.25, 99.75);
  const right = clamp(Math.max(source.display.x, target.display.x) + horizontalPadding, 0.25, 99.75);
  const top = clamp(Math.min(source.display.y, target.display.y) - topPadding, 0.25, 99.75);
  const bottom = clamp(Math.max(source.display.y, target.display.y) + bottomPadding, 0.25, 99.75);
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  outline.setAttribute("x", left);
  outline.setAttribute("y", top);
  outline.setAttribute("width", Math.max(1, right - left));
  outline.setAttribute("height", Math.max(1, bottom - top));
  outline.setAttribute("rx", "1.8");
  outline.setAttribute("class", `conversation-outline ${conversation.tone}`);
  outline.dataset.conversationId = conversation.id;
  dom.relationLayer.append(outline);
}

function renderRelations(frame, currentEvents, conversations = []) {
  dom.relationLayer.replaceChildren();
  dom.relationLayer.setAttribute("viewBox", "0 0 100 100");
  dom.relationLayer.setAttribute("preserveAspectRatio", "none");
  const agentById = new Map(frame.agents.map((agent) => [Number(agent.id), agent]));
  const primaryEventIds = new Set(conversations.map((conversation) => String(conversation.eventId)));

  conversations.forEach((conversation) => {
    const source = agentById.get(conversation.source);
    const target = agentById.get(conversation.target);
    if (source && target) appendConversationOutline(source, target, conversation);
  });

  currentEvents.forEach((event) => {
    if (primaryEventIds.has(String(event.id))) return;
    if (event.source === null || event.target === null) return;
    const source = agentById.get(event.source);
    const target = agentById.get(event.target);
    if (!source || !target) return;
    appendRelationLine(source, target, `relation-line ${event.tone}`);
  });

  conversations.forEach((conversation) => {
    const source = agentById.get(conversation.source);
    const target = agentById.get(conversation.target);
    if (!source || !target) return;
    const line = appendRelationLine(source, target, `conversation-line ${conversation.tone}`);
    line.dataset.conversationId = conversation.id;
  });
}

function renderFocus() {
  if (state.focusedAgentId === null) {
    dom.focusEmpty.hidden = false;
    dom.focusContent.hidden = true;
    return;
  }
  const agent = agentById(state.focusedAgentId);
  const snapshot = frameAgentById(state.focusedAgentId);
  if (!agent) {
    state.focusedAgentId = null;
    renderFocus();
    return;
  }

  dom.focusEmpty.hidden = true;
  dom.focusContent.hidden = false;
  dom.focusName.textContent = agent.name;
  dom.focusRole.textContent = agent.role;
  dom.focusId.textContent = `#${String(agent.id).padStart(3, "0")}`;
  dom.focusState.textContent = text(snapshot?.state, t("common.notVisible"));
  dom.focusPlace.textContent = text(snapshot?.place || t("common.publicSpace"), t("common.notVisible"));
  dom.focusAvatar.className = `mini-avatar gender-${agent.appearance.gender} ${agent.appearance.spriteId}`;
  applyCharacterSpriteStyle(dom.focusAvatar, agent.appearance);
  dom.profileGrid.replaceChildren();

  const fields = Object.entries(agent.profile || {}).slice(0, 6);
  if (fields.length === 0) fields.push(["profile", t("common.noExtraFields")]);
  fields.forEach(([key, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key.replaceAll("_", " ").toUpperCase();
    dd.textContent = text(parseMaybeJson(value));
    dd.title = dd.textContent;
    wrapper.append(dt, dd);
    dom.profileGrid.append(wrapper);
  });
}

function renderEventList(frame) {
  dom.eventList.replaceChildren();
  if (state.data.events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-events";
    empty.textContent = t("viewer.noEvents");
    dom.eventList.append(empty);
    return;
  }

  [...state.data.events].reverse().forEach((event) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "event-item";
    item.dataset.eventId = event.id;
    if (event.step === frame.step) item.classList.add("is-current");
    item.style.opacity = event.step > frame.step ? "0.48" : "1";

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = event.time || `S${event.step}`;

    const body = document.createElement("span");
    body.className = "event-body";
    const route = document.createElement("span");
    route.className = "event-route";
    const sourceName = event.source === null ? "ENV" : agentById(event.source)?.name || `#${event.source}`;
    const targetName = event.target === null ? "SPACE" : agentById(event.target)?.name || `#${event.target}`;
    route.append(document.createTextNode(sourceName));
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    route.append(arrow, document.createTextNode(targetName));

    const content = document.createElement("p");
    content.className = "event-content";
    content.textContent = event.content;
    const tag = document.createElement("span");
    tag.className = `event-tag ${event.tone}`;
    tag.textContent = `${toneLabel(event.tone)} · ${event.type}`;
    body.append(route, content, tag, buildEventAudit(event));
    item.append(time, body);
    item.addEventListener("click", () => goToStep(event.step));
    dom.eventList.append(item);
  });
}

function renderTimelineTicks() {
  dom.timelineTicks.replaceChildren();
  dom.timelineEvents.replaceChildren();
  const markers = buildTimelineMarkers(state.data.frames, state.data.events);
  state.data.frames.forEach((frame) => {
    const tick = document.createElement("i");
    const marker = markers.find((item) => item.step === Number(frame.step));
    if (marker?.dialogueCount) tick.className = "has-event";
    dom.timelineTicks.append(tick);
  });
  markers.filter((marker) => marker.dialogueCount > 0).forEach((marker) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline-event-marker";
    button.dataset.step = String(marker.step);
    button.style.left = `${marker.position * 100}%`;
    button.textContent = String(marker.dialogueCount);
    const label = t("viewer.timelineEvent", {
      step: String(marker.step).padStart(2, "0"),
      time: marker.time,
      count: marker.dialogueCount,
      turns: marker.turnCount,
    });
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => goToStep(marker.step));
    dom.timelineEvents.append(button);
  });
}

function goToStep(step) {
  stopPlayback();
  state.bubbleStep = null;
  state.bubblePage = 0;
  state.bubbleTurn = 0;
  const exactIndex = state.data.frames.findIndex((frame) => frame.step === Number(step));
  if (exactIndex >= 0) {
    state.frameIndex = exactIndex;
  } else {
    state.frameIndex = state.data.frames.reduce((best, frame, index) => {
      const currentDistance = Math.abs(frame.step - Number(step));
      const bestDistance = Math.abs(state.data.frames[best].step - Number(step));
      return currentDistance < bestDistance ? index : best;
    }, 0);
  }
  state.timelineCursor = state.frameIndex;
  render();
}

function cancelPlaybackClock() {
  window.clearTimeout(state.timer);
  window.clearTimeout(state.playbackPauseTimer);
  window.cancelAnimationFrame(state.playbackRaf);
  state.timer = null;
  state.playbackPauseTimer = null;
  state.playbackRaf = null;
  state.playbackWindow = null;
}

function stopPlayback() {
  state.playing = false;
  cancelPlaybackClock();
  state.activeTransition = null;
  state.timelineCursor = state.frameIndex;
  clearMovementEffects();
  dom.playButton.classList.remove("is-playing");
  dom.playButton.setAttribute("aria-label", t("viewer.play"));
}

function updateTimelineCursor(cursor) {
  const lastIndex = Math.max(0, state.data.frames.length - 1);
  state.timelineCursor = clamp(cursor, 0, lastIndex);
  const progress = lastIndex === 0 ? 0 : (state.timelineCursor / lastIndex) * 100;
  dom.timeline.value = String(state.timelineCursor);
  dom.timeline.style.setProperty("--timeline-progress", `${progress}%`);
}

function playbackDwellDuration() {
  const currentEvents = eventsAtStep(currentFrame().step);
  const groups = buildEncounterGroups(currentEvents);
  const hasDialogues = groups.some((group) => group.length > 0);
  const demoDuration = state.bubbleDemoEnabled && hasDialogues
    ? playbackDuration(buildEncounterGroups(currentEvents), turnDurationFromFrameDelay(dom.speedSelect.value))
    : 0;
  return Math.max(Number(dom.speedSelect.value), demoDuration);
}

function startTransition(targetIndex, duration) {
  if (state.activeTransition || targetIndex === state.frameIndex) return;
  clearBubbleRotation();
  state.activeTransition = { targetIndex, duration };
  render();
}

function completePlaybackWindow(windowState) {
  const lastIndex = state.data.frames.length - 1;
  if (windowState.frameIndex >= lastIndex) {
    state.frameIndex = 0;
    state.timelineCursor = 0;
    state.lastMovementSnapshot = null;
    state.activeTransition = null;
    render();
    state.playbackPauseTimer = window.setTimeout(() => beginPlaybackWindow(), LOOP_PAUSE_MS);
    return;
  }
  state.frameIndex = windowState.frameIndex + 1;
  state.timelineCursor = state.frameIndex;
  state.activeTransition = null;
  const targetLayout = displayLayoutForFrame(currentFrame());
  state.lastMovementSnapshot = movementSnapshot(targetLayout.frame, state.frameIndex);
  render();
  beginPlaybackWindow();
}

function beginPlaybackWindow() {
  cancelPlaybackClock();
  if (!state.playing || !state.data) return;
  const windowState = createPlaybackWindow({
    frameIndex: state.frameIndex,
    frameCount: state.data.frames.length,
    dwellMs: playbackDwellDuration(),
  });
  state.playbackWindow = windowState;
  const startedAt = performance.now();
  const tick = (now) => {
    if (!state.playing || state.playbackWindow !== windowState) return;
    const sample = samplePlaybackWindow(windowState, now - startedAt);
    if (windowState.frameIndex < state.data.frames.length - 1) updateTimelineCursor(sample.cursor);
    else updateTimelineCursor(windowState.frameIndex);
    if (sample.phase === "transition" && windowState.frameIndex < state.data.frames.length - 1) {
      startTransition(windowState.frameIndex + 1, windowState.transitionMs);
    }
    if (sample.phase === "complete") {
      completePlaybackWindow(windowState);
      return;
    }
    state.playbackRaf = window.requestAnimationFrame(tick);
  };
  state.playbackRaf = window.requestAnimationFrame(tick);
}

function togglePlayback() {
  if (!state.data) return;
  state.playing = !state.playing;
  dom.playButton.classList.toggle("is-playing", state.playing);
  dom.playButton.setAttribute("aria-label", state.playing ? t("viewer.pause") : t("viewer.play"));
  if (state.playing) beginPlaybackWindow();
  else stopPlayback();
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2400);
}

function installData(raw, message = t("viewer.replayLoaded")) {
  clearMovementEffects();
  state.lastMovementSnapshot = null;
  state.data = normalizeData(raw);
  state.relationshipDashboard = buildRelationshipDashboard(state.data);
  state.dashboardMode = "overview";
  state.dashboardAgentId = state.data.agents[0]?.id ?? null;
  state.relationPulseStep = null;
  state.relationPulseStartedAt = 0;
  rebuildReplayLayout();
  dom.world.classList.toggle("is-dense", state.data.agents.length > 12);
  state.frameIndex = 0;
  state.timelineCursor = 0;
  state.bubblePage = 0;
  state.bubbleTurn = 0;
  state.bubbleStep = null;
  state.focusedAgentId = null;
  stopPlayback();
  dom.timeline.max = String(Math.max(0, state.data.frames.length - 1));
  renderTimelineTicks();
  render();
  showToast(message);
}

async function loadDemo() {
  const requestedReplay = new URLSearchParams(window.location.search).get("replay");
  if (requestedReplay && !/^[a-zA-Z0-9._-]+\.json$/.test(requestedReplay)) {
    throw new Error(t("viewer.invalidReplayParam"));
  }
  const replayFile = requestedReplay || "demo.json";
  const response = await fetch(`./data/${replayFile}`);
  if (!response.ok) throw new Error(t("viewer.demoReadFailed", { status: response.status }));
  installData(await response.json(), requestedReplay ? t("viewer.fileLoaded", { file: replayFile }) : t("viewer.demoReady"));
}

async function loadWorldMap() {
  const catalog = await loadAssetCatalog(ASSET_CATALOG_URL);
  const useDraft = new URLSearchParams(window.location.search).get("map") === "draft";
  let map;
  if (useDraft) {
    const rawDraft = window.localStorage.getItem(MAP_DRAFT_KEY);
    if (!rawDraft) throw new Error(t("viewer.noDraft"));
    map = JSON.parse(rawDraft);
    const validation = validateMap(map, catalog);
    if (!validation.valid) throw new Error(t("viewer.invalidDraft", { error: validation.errors.join("; ") }));
  } else {
    map = await loadMap(DEFAULT_MAP_URL, catalog);
  }
  state.map = map;
  state.mapRenderer?.destroy();
  state.mapRenderer = renderMap(dom.mapLayer, map, { catalog });
  rebuildReplayLayout();
  if (state.data) render();
  if (useDraft) showToast(t("viewer.previewingDraft"));
}

dom.playButton.addEventListener("click", togglePlayback);
dom.dashboardOverviewButton.addEventListener("click", () => {
  state.dashboardMode = "overview";
  render();
});
dom.dashboardIndividualButton.addEventListener("click", () => {
  state.dashboardMode = "individual";
  render();
});
dom.movementMode.addEventListener("change", () => {
  state.movementMode = normalizeMovementMode(dom.movementMode.value);
  window.localStorage.setItem(MOVEMENT_MODE_KEY, state.movementMode);
  clearMovementEffects();
});
dom.roadMovementButton.addEventListener("click", () => {
  state.roadMovement = !state.roadMovement;
  window.localStorage.setItem(ROAD_MOVEMENT_KEY, String(state.roadMovement));
  updateRoadMovementControl();
  clearMovementEffects();
});
dom.bubbleDemoButton.addEventListener("click", () => {
  state.bubbleDemoEnabled = !state.bubbleDemoEnabled;
  state.bubblePage = 0;
  state.bubbleTurn = 0;
  clearBubbleRotation();
  if (state.playing) {
    state.activeTransition = null;
    state.timelineCursor = state.frameIndex;
    clearMovementEffects();
  }
  render();
  if (state.playing) beginPlaybackWindow();
});
dom.speedSelect.addEventListener("change", () => {
  clearBubbleRotation();
  if (state.playing) {
    state.activeTransition = null;
    state.timelineCursor = state.frameIndex;
    clearMovementEffects();
  }
  render();
  if (state.playing) beginPlaybackWindow();
});
dom.timeline.addEventListener("input", (event) => {
  stopPlayback();
  state.frameIndex = Math.round(Number(event.target.value));
  state.timelineCursor = state.frameIndex;
  state.bubbleStep = null;
  render();
});
dom.guideButton.addEventListener("click", () => {
  dom.guideButton.setAttribute("aria-expanded", "true");
  dom.usageGuide.showModal();
});
dom.usageGuide.addEventListener("close", () => {
  dom.guideButton.setAttribute("aria-expanded", "false");
  dom.guideButton.focus();
});
dom.usageGuide.addEventListener("click", (event) => {
  if (event.target === dom.usageGuide) dom.usageGuide.close();
});
dom.clearFocus.addEventListener("click", () => {
  state.focusedAgentId = null;
  render();
});
dom.dataFile.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    installData(JSON.parse(await file.text()), t("viewer.fileLoaded", { file: file.name }));
  } catch (error) {
    showToast(t("viewer.importFailed", { error: error.message }));
  } finally {
    event.target.value = "";
  }
});

document.addEventListener("keydown", (event) => {
  if (!state.data || event.target.matches("input, select")) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowRight") {
    stopPlayback();
    state.frameIndex = Math.min(state.frameIndex + 1, state.data.frames.length - 1);
    state.timelineCursor = state.frameIndex;
    state.bubbleStep = null;
    render();
  } else if (event.code === "ArrowLeft") {
    stopPlayback();
    state.frameIndex = Math.max(state.frameIndex - 1, 0);
    state.timelineCursor = state.frameIndex;
    state.bubbleStep = null;
    render();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPlayback();
    clearBubbleRotation();
    clearMovementEffects();
  }
  else if (state.data) render();
});

window.addEventListener("i18n:change", ({ detail }) => {
  state.mapRenderer?.setLanguage(detail.language);
  if (state.data) render();
});

loadWorldMap().catch((error) => {
  console.error(error);
  renderMapError(dom.mapLayer, error.message);
  showToast(error.message);
});

loadDemo().catch((error) => {
  console.error(error);
  showToast(error.message);
});
