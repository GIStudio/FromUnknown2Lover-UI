import {
  ASSET_CATALOG_URL,
  DEFAULT_MAP_URL,
  LEGACY_MAP_DRAFT_KEY,
  MAP_DRAFT_KEY,
  applySpriteStyle,
  assetPackById,
  cloneMap,
  loadAssetCatalog,
  loadMap,
  renderMap,
  simulationStatusForObject,
  validateMap,
  worldValueToPercent,
} from "./map-renderer.js?v=20260720-dashboard-fix";
import { bindLanguageControls, getLanguage, initI18n, t } from "./i18n.js?v=20260720-dashboard-fix";

initI18n();
bindLanguageControls();

const BASE_CANVAS_WIDTH = 640;
const BASE_CANVAS_HEIGHT = 960;
const HISTORY_LIMIT = 50;
const DRAG_MIME = "application/x-common-ground-map-object";

const semanticTemplates = [
  { id: "road", kind: "road", variant: "vertical", layer: "infrastructure", width: 10, height: 72 },
  { id: "crosswalk", kind: "crosswalk", variant: "horizontal", layer: "infrastructure", width: 14, height: 6 },
  { id: "rail", kind: "rail", variant: "vertical", layer: "infrastructure", width: 8, height: 72 },
  { id: "venue", kind: "venue", variant: "generic", layer: "venues", width: 48, height: 50, labelZh: "新场所", labelEn: "NEW VENUE" },
  { id: "building", kind: "building", variant: "generic", layer: "venues", width: 46, height: 50, labelZh: "新建筑", labelEn: "BUILDING" },
  { id: "label", kind: "label", variant: "plain", layer: "decor", width: 36, height: 14, labelZh: "地图标签", labelEn: "LABEL" },
];

const dom = {
  semanticPalette: document.querySelector("#semantic-palette"),
  packTabs: document.querySelector("#pack-tabs"),
  assetSearch: document.querySelector("#asset-search"),
  assetCategory: document.querySelector("#asset-category"),
  tilePalette: document.querySelector("#tile-palette"),
  tileCount: document.querySelector("#tile-count"),
  packSource: document.querySelector("#pack-source"),
  mapName: document.querySelector("#map-name"),
  objectCount: document.querySelector("#object-count"),
  editorWorld: document.querySelector("#editor-world"),
  mapLayer: document.querySelector("#editor-map-layer"),
  selectionOverlay: document.querySelector("#selection-overlay"),
  selectionId: document.querySelector("#selection-id"),
  selectionKind: document.querySelector("#selection-kind"),
  inspectorEmpty: document.querySelector("#inspector-empty"),
  inspectorForm: document.querySelector("#inspector-form"),
  fieldId: document.querySelector("#field-id"),
  fieldKind: document.querySelector("#field-kind"),
  fieldLayer: document.querySelector("#field-layer"),
  fieldX: document.querySelector("#field-x"),
  fieldY: document.querySelector("#field-y"),
  fieldWidth: document.querySelector("#field-width"),
  fieldHeight: document.querySelector("#field-height"),
  fieldZ: document.querySelector("#field-z"),
  fieldRotation: document.querySelector("#field-rotation"),
  fieldVariant: document.querySelector("#field-variant"),
  fieldLabelZh: document.querySelector("#field-label-zh"),
  fieldLabelEn: document.querySelector("#field-label-en"),
  simulationFields: document.querySelector("#simulation-fields"),
  fieldSimulationStatus: document.querySelector("#field-simulation-status"),
  fieldSourceBuildingId: document.querySelector("#field-source-building-id"),
  assetReadout: document.querySelector("#asset-readout"),
  undoButton: document.querySelector("#undo-button"),
  redoButton: document.querySelector("#redo-button"),
  duplicateButton: document.querySelector("#duplicate-button"),
  rotateButton: document.querySelector("#rotate-button"),
  frontButton: document.querySelector("#front-button"),
  backButton: document.querySelector("#back-button"),
  deleteButton: document.querySelector("#delete-button"),
  mapFile: document.querySelector("#map-file"),
  exportButton: document.querySelector("#export-button"),
  resetButton: document.querySelector("#reset-button"),
  previewButton: document.querySelector("#preview-button"),
  snapToggle: document.querySelector("#snap-toggle"),
  zoomControl: document.querySelector("#zoom-control"),
  zoomLabel: document.querySelector("#zoom-label"),
  draftStatus: document.querySelector("#draft-status"),
  toast: document.querySelector("#editor-toast"),
};

const state = {
  map: null,
  defaultMap: null,
  catalog: null,
  renderer: null,
  selectedId: null,
  selectedPackId: null,
  history: [],
  future: [],
  snap: true,
  zoom: 1,
  gesture: null,
  saveTimer: null,
  lastSavedAt: null,
};

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2400);
}

function selectedObject(map = state.map) {
  return map?.objects.find((object) => object.id === state.selectedId) || null;
}

function layerById(layerId) {
  return state.map?.layers.find((layer) => layer.id === layerId) || null;
}

function removeSimulationReferences(map, objectId) {
  Object.entries(map.simulation.buildingMappings).forEach(([sourceId, mappedId]) => {
    if (mappedId === objectId) delete map.simulation.buildingMappings[sourceId];
  });
  map.simulation.displayOnlyObjectIds = map.simulation.displayOnlyObjectIds.filter((id) => id !== objectId);
}

function markDisplayOnly(map, objectId) {
  removeSimulationReferences(map, objectId);
  if (!map.simulation.displayOnlyObjectIds.includes(objectId)) {
    map.simulation.displayOnlyObjectIds.push(objectId);
  }
}

function mapSourceBuilding(map, objectId, sourceBuildingId) {
  const previousObjectId = map.simulation.buildingMappings[sourceBuildingId];
  removeSimulationReferences(map, objectId);
  if (previousObjectId && previousObjectId !== objectId) markDisplayOnly(map, previousObjectId);
  map.simulation.buildingMappings[sourceBuildingId] = objectId;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function snapValue(value, bypass = false) {
  if (!state.snap || bypass) return Math.round(value * 10) / 10;
  const grid = Number(state.map.world.grid || 1);
  return Math.round(value / grid) * grid;
}

function uniqueId(prefix, map = state.map) {
  const base = String(prefix || "object").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "object";
  let index = 1;
  let candidate = `${base}-${index}`;
  const ids = new Set(map.objects.map((object) => object.id));
  while (ids.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
}

function recordHistory(snapshot = state.map) {
  state.history.push(cloneMap(snapshot));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  dom.undoButton.disabled = state.history.length === 0;
  dom.redoButton.disabled = state.future.length === 0;
}

function scheduleDraftSave() {
  window.clearTimeout(state.saveTimer);
  dom.draftStatus.textContent = t("editor.saving");
  state.saveTimer = window.setTimeout(() => saveDraft(), 180);
}

function saveDraft() {
  if (!state.map) return;
  try {
    window.localStorage.setItem(MAP_DRAFT_KEY, JSON.stringify(state.map));
    state.lastSavedAt = new Date();
    const locale = getLanguage() === "zh" ? "zh-CN" : "en-US";
    const time = state.lastSavedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dom.draftStatus.textContent = t("editor.saved", { time });
  } catch (error) {
    dom.draftStatus.textContent = t("editor.saveFailed");
    showToast(t("editor.draftSaveFailed", { error: error.message }));
  }
}

function renderEditor({ refreshInspector = true } = {}) {
  if (!state.map) return;
  if (!state.renderer) {
    state.renderer = renderMap(dom.mapLayer, state.map, {
      catalog: state.catalog,
      editable: true,
      selectedId: state.selectedId,
    });
  } else {
    state.renderer.setMap(state.map, { selectedId: state.selectedId });
  }
  dom.mapName.textContent = state.map.name || state.map.id;
  dom.objectCount.textContent = `${state.map.objects.length} OBJECTS`;
  syncSelectionOverlay();
  if (refreshInspector) syncInspector();
  scheduleDraftSave();
  updateHistoryButtons();
}

function installMap(map, { clearHistory = false, message = t("editor.mapLoaded") } = {}) {
  const validation = validateMap(map, state.catalog);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  state.map = cloneMap(map);
  state.selectedId = null;
  updateZoom();
  if (clearHistory) {
    state.history = [];
    state.future = [];
  }
  renderEditor();
  showToast(message);
}

function commitCandidate(candidate, message = null) {
  const validation = validateMap(candidate, state.catalog);
  if (!validation.valid) {
    showToast(t("editor.changeRejected", { error: validation.errors[0] }));
    syncInspector();
    return false;
  }
  recordHistory();
  state.map = candidate;
  renderEditor();
  if (message) showToast(message);
  return true;
}

function setSelected(objectId) {
  state.selectedId = objectId && state.map.objects.some((object) => object.id === objectId) ? objectId : null;
  state.renderer?.setSelected(state.selectedId);
  syncSelectionOverlay();
  syncInspector();
}

function syncSelectionOverlay() {
  const object = selectedObject();
  if (!object) {
    dom.selectionOverlay.hidden = true;
    return;
  }
  dom.selectionOverlay.hidden = false;
  dom.selectionOverlay.style.left = `${worldValueToPercent(object.x, state.map.world.width)}%`;
  dom.selectionOverlay.style.top = `${worldValueToPercent(object.y, state.map.world.height)}%`;
  dom.selectionOverlay.style.width = `${worldValueToPercent(object.width, state.map.world.width)}%`;
  dom.selectionOverlay.style.height = `${worldValueToPercent(object.height, state.map.world.height)}%`;
  dom.selectionOverlay.style.transform = `rotate(${Number(object.rotation || 0)}deg)`;
  dom.selectionId.textContent = object.id;
}

function fillSelect(select, values, selected) {
  select.replaceChildren();
  values.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  });
}

function syncInspector() {
  const object = selectedObject();
  dom.inspectorEmpty.hidden = Boolean(object);
  dom.inspectorForm.hidden = !object;
  dom.selectionKind.textContent = object ? `${object.kind.toUpperCase()} / ${object.layer}` : "NO SELECTION";
  if (!object) return;

  dom.fieldId.value = object.id;
  fillSelect(dom.fieldKind, ["road", "rail", "crosswalk", "venue", "building", "label", "decor", "sprite"].map((kind) => ({ value: kind, label: kind })), object.kind);
  fillSelect(dom.fieldLayer, state.map.layers.map((layer) => ({ value: layer.id, label: `${layer.id}${layer.locked ? " · locked" : ""}` })), object.layer);
  dom.fieldX.value = object.x;
  dom.fieldY.value = object.y;
  dom.fieldWidth.value = object.width;
  dom.fieldHeight.value = object.height;
  dom.fieldZ.value = object.z || 0;
  dom.fieldRotation.value = String(Number(object.rotation || 0));
  dom.fieldVariant.value = object.variant || "";
  dom.fieldLabelZh.value = object.label?.zh || "";
  dom.fieldLabelEn.value = object.label?.en || "";
  const semantic = ["venue", "building"].includes(object.kind);
  const simulation = simulationStatusForObject(state.map, object.id);
  dom.simulationFields.hidden = !semantic;
  dom.fieldSimulationStatus.value = simulation.status === "mapped" ? "mapped" : "display_only";
  dom.fieldSourceBuildingId.value = simulation.sourceBuildingId || "";
  dom.fieldSourceBuildingId.disabled = !semantic;
  dom.assetReadout.hidden = object.kind !== "sprite";
  dom.assetReadout.textContent = object.kind === "sprite"
    ? `${object.asset?.packId || "unknown"} / TILE ${String(object.asset?.tileIndex ?? "?").padStart(4, "0")}`
    : "";
}

function renderSemanticPalette() {
  dom.semanticPalette.replaceChildren();
  semanticTemplates.forEach((template) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "semantic-tool";
    button.draggable = true;
    button.dataset.template = template.id;
    const templateLabel = t(`editor.template.${template.id}`);
    button.title = t("editor.addTemplate", { name: templateLabel });
    const icon = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = templateLabel;
    button.append(icon, label);
    button.addEventListener("dragstart", (event) => setDragPayload(event, { type: "semantic", templateId: template.id }));
    button.addEventListener("click", () => addPayload({ type: "semantic", templateId: template.id }, { x: 50, y: 50 }));
    dom.semanticPalette.append(button);
  });
}

function renderPackTabs() {
  dom.packTabs.replaceChildren();
  state.catalog.packs.forEach((pack) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pack-tab";
    button.classList.toggle("is-active", pack.id === state.selectedPackId);
    button.textContent = pack.name;
    button.title = pack.name;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(pack.id === state.selectedPackId));
    button.addEventListener("click", () => {
      state.selectedPackId = pack.id;
      dom.assetSearch.value = "";
      renderPackTabs();
      renderCategoryOptions();
      renderTilePalette();
    });
    dom.packTabs.append(button);
  });
}

function renderCategoryOptions() {
  const pack = assetPackById(state.catalog, state.selectedPackId);
  const values = [
    { value: "all", label: t("editor.category.all") },
    ...(pack?.groups || []).map((group) => ({
      value: group.id,
      label: t(`editor.category.${group.id}`, {}, group.name),
    })),
  ];
  fillSelect(dom.assetCategory, values, "all");
}

function tileMatchesGroup(tileIndex, group) {
  if (!group) return true;
  return (group.ranges || []).some(([start, end]) => tileIndex >= start && tileIndex <= end);
}

function renderTilePalette() {
  const pack = assetPackById(state.catalog, state.selectedPackId);
  if (!pack) return;
  const query = dom.assetSearch.value.trim().toLowerCase().replace(/^tile[-_ ]?/, "");
  const group = pack.groups?.find((item) => item.id === dom.assetCategory.value);
  dom.tilePalette.replaceChildren();
  let shown = 0;

  for (let tileIndex = 0; tileIndex < pack.count; tileIndex += 1) {
    if (group && !tileMatchesGroup(tileIndex, group)) continue;
    const padded = String(tileIndex).padStart(4, "0");
    if (query && !String(tileIndex).includes(query) && !padded.includes(query)) continue;
    shown += 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-tile";
    button.draggable = true;
    button.title = `${pack.name} / tile ${padded}`;
    const preview = document.createElement("span");
    preview.className = "tile-preview";
    applySpriteStyle(preview, pack, tileIndex);
    const label = document.createElement("small");
    label.textContent = padded;
    button.append(preview, label);
    const payload = { type: "sprite", packId: pack.id, tileIndex };
    button.addEventListener("dragstart", (event) => setDragPayload(event, payload));
    button.addEventListener("click", () => addPayload(payload, { x: 50, y: 50 }));
    dom.tilePalette.append(button);
  }

  dom.tileCount.textContent = `${shown} / ${pack.count} TILES`;
  dom.packSource.href = pack.source;
}

function setDragPayload(event, payload) {
  const serialized = JSON.stringify(payload);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(DRAG_MIME, serialized);
  event.dataTransfer.setData("text/plain", serialized);
}

function pointerToWorld(clientX, clientY) {
  const rect = dom.editorWorld.getBoundingClientRect();
  return {
    x: clamp(((clientX - rect.left) / rect.width) * state.map.world.width, 0, state.map.world.width),
    y: clamp(((clientY - rect.top) / rect.height) * state.map.world.height, 0, state.map.world.height),
  };
}

function addPayload(payload, point) {
  let object;
  if (payload.type === "sprite") {
    object = {
      id: uniqueId("sprite"),
      layer: "decor",
      kind: "sprite",
      variant: "tile",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      rotation: 0,
      z: 0,
      asset: { packId: payload.packId, tileIndex: Number(payload.tileIndex) },
    };
  } else {
    const template = semanticTemplates.find((item) => item.id === payload.templateId);
    if (!template) return;
    object = {
      id: uniqueId(template.kind),
      layer: template.layer,
      kind: template.kind,
      variant: template.variant,
      x: 0,
      y: 0,
      width: template.width,
      height: template.height,
      rotation: 0,
      z: 0,
      shape: { type: "rect" },
    };
    if (template.labelZh || template.labelEn) object.label = { zh: template.labelZh || "", en: template.labelEn || "" };
  }

  object.x = snapValue(clamp(point.x - object.width / 2, 0, state.map.world.width - object.width));
  object.y = snapValue(clamp(point.y - object.height / 2, 0, state.map.world.height - object.height));
  const candidate = cloneMap(state.map);
  candidate.objects.push(object);
  if (["venue", "building"].includes(object.kind)) markDisplayOnly(candidate, object.id);
  if (commitCandidate(candidate, t("editor.added", { id: object.id }))) setSelected(object.id);
}

function startGesture(event, mode, direction = null) {
  const object = selectedObject();
  if (!object || layerById(object.layer)?.locked) {
    if (object) showToast(t("editor.layerLocked", { layer: object.layer }));
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  state.gesture = {
    mode,
    direction,
    startPointer: pointerToWorld(event.clientX, event.clientY),
    startObject: cloneMap(object),
    before: cloneMap(state.map),
    changed: false,
    bypassSnap: event.shiftKey,
  };
}

function applyMoveGesture(gesture, pointer) {
  const start = gesture.startObject;
  const dx = pointer.x - gesture.startPointer.x;
  const dy = pointer.y - gesture.startPointer.y;
  return {
    ...start,
    x: snapValue(clamp(start.x + dx, 0, state.map.world.width - start.width), gesture.bypassSnap),
    y: snapValue(clamp(start.y + dy, 0, state.map.world.height - start.height), gesture.bypassSnap),
  };
}

function applyResizeGesture(gesture, pointer) {
  const start = gesture.startObject;
  const direction = gesture.direction;
  const dx = pointer.x - gesture.startPointer.x;
  const dy = pointer.y - gesture.startPointer.y;
  const result = { ...start };
  const minimum = Number(state.map.world.grid || 1);

  if (direction.includes("e")) result.width = clamp(start.width + dx, minimum, state.map.world.width - start.x);
  if (direction.includes("s")) result.height = clamp(start.height + dy, minimum, state.map.world.height - start.y);
  if (direction.includes("w")) {
    result.x = clamp(start.x + dx, 0, start.x + start.width - minimum);
    result.width = start.width + (start.x - result.x);
  }
  if (direction.includes("n")) {
    result.y = clamp(start.y + dy, 0, start.y + start.height - minimum);
    result.height = start.height + (start.y - result.y);
  }

  result.x = snapValue(result.x, gesture.bypassSnap);
  result.y = snapValue(result.y, gesture.bypassSnap);
  result.width = snapValue(result.width, gesture.bypassSnap);
  result.height = snapValue(result.height, gesture.bypassSnap);
  result.width = clamp(result.width, minimum, state.map.world.width - result.x);
  result.height = clamp(result.height, minimum, state.map.world.height - result.y);
  return result;
}

function onPointerMove(event) {
  if (!state.gesture) return;
  const pointer = pointerToWorld(event.clientX, event.clientY);
  const nextObject = state.gesture.mode === "resize"
    ? applyResizeGesture(state.gesture, pointer)
    : applyMoveGesture(state.gesture, pointer);
  if (!state.gesture.changed) {
    state.history.push(state.gesture.before);
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future = [];
    state.gesture.changed = true;
  }
  const index = state.map.objects.findIndex((object) => object.id === state.selectedId);
  state.map.objects[index] = nextObject;
  renderEditor({ refreshInspector: true });
}

function endGesture() {
  if (!state.gesture) return;
  if (state.gesture.changed) saveDraft();
  state.gesture = null;
  updateHistoryButtons();
}

function undo() {
  if (state.history.length === 0) return;
  state.future.push(cloneMap(state.map));
  state.map = state.history.pop();
  if (!selectedObject()) state.selectedId = null;
  renderEditor();
}

function redo() {
  if (state.future.length === 0) return;
  state.history.push(cloneMap(state.map));
  state.map = state.future.pop();
  if (!selectedObject()) state.selectedId = null;
  renderEditor();
}

function duplicateSelected() {
  const object = selectedObject();
  if (!object) return;
  const candidate = cloneMap(state.map);
  const duplicate = cloneMap(object);
  duplicate.id = uniqueId(object.kind, candidate);
  duplicate.x = snapValue(clamp(object.x + state.map.world.grid, 0, state.map.world.width - object.width));
  duplicate.y = snapValue(clamp(object.y + state.map.world.grid, 0, state.map.world.height - object.height));
  candidate.objects.push(duplicate);
  if (["venue", "building"].includes(duplicate.kind)) markDisplayOnly(candidate, duplicate.id);
  if (commitCandidate(candidate, t("editor.copied", { id: duplicate.id }))) setSelected(duplicate.id);
}

function deleteSelected() {
  const object = selectedObject();
  if (!object) return;
  if (layerById(object.layer)?.locked) {
    showToast(t("editor.layerLocked", { layer: object.layer }));
    return;
  }
  const candidate = cloneMap(state.map);
  candidate.objects = candidate.objects.filter((item) => item.id !== object.id);
  removeSimulationReferences(candidate, object.id);
  state.selectedId = null;
  commitCandidate(candidate, t("editor.deleted", { id: object.id }));
}

function updateSelected(mutator, message = null) {
  if (!selectedObject()) return false;
  const candidate = cloneMap(state.map);
  const object = candidate.objects.find((item) => item.id === state.selectedId);
  mutator(object, candidate);
  return commitCandidate(candidate, message);
}

function moveLayerOrder(toFront) {
  const object = selectedObject();
  if (!object) return;
  const siblings = state.map.objects.filter((item) => item.layer === object.layer && item.id !== object.id);
  const values = siblings.map((item) => Number(item.z || 0));
  const edge = values.length ? (toFront ? Math.max(...values) : Math.min(...values)) : 0;
  updateSelected((item) => { item.z = edge + (toFront ? 1 : -1); }, toFront ? t("editor.broughtForward") : t("editor.sentBackward"));
}

function rotateSelected() {
  updateSelected((object) => { object.rotation = (Number(object.rotation || 0) + 90) % 360; }, t("editor.rotated"));
}

function exportMap() {
  const validation = validateMap(state.map, state.catalog);
  if (!validation.valid) {
    showToast(t("editor.exportFailed", { error: validation.errors[0] }));
    return;
  }
  const blob = new Blob([`${JSON.stringify(state.map, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "map.json";
  link.click();
  URL.revokeObjectURL(url);
  showToast(t("editor.downloaded"));
}

function updateZoom() {
  state.zoom = Number(dom.zoomControl.value) / 100;
  dom.zoomLabel.textContent = `${dom.zoomControl.value}%`;
  dom.editorWorld.style.width = `${BASE_CANVAS_WIDTH * state.zoom}px`;
  dom.editorWorld.style.height = `${BASE_CANVAS_HEIGHT * state.zoom}px`;
  if (state.map) {
    dom.editorWorld.style.setProperty("--major-grid-x", `${worldValueToPercent(10, state.map.world.width)}%`);
    dom.editorWorld.style.setProperty("--major-grid-y", `${worldValueToPercent(10, state.map.world.height)}%`);
  }
}

function onInspectorChange(event) {
  const field = event.target.name;
  if (!field || !selectedObject()) return;
  const previousId = state.selectedId;
  const candidate = cloneMap(state.map);
  const object = candidate.objects.find((item) => item.id === previousId);
  const wasSemantic = ["venue", "building"].includes(object.kind);

  if (field === "id") {
    object.id = event.target.value.trim();
    Object.entries(candidate.simulation.buildingMappings).forEach(([sourceId, mappedId]) => {
      if (mappedId === previousId) candidate.simulation.buildingMappings[sourceId] = object.id;
    });
    candidate.simulation.displayOnlyObjectIds = candidate.simulation.displayOnlyObjectIds
      .map((objectId) => (objectId === previousId ? object.id : objectId));
  }
  else if (["x", "y", "width", "height", "z", "rotation"].includes(field)) object[field] = Number(event.target.value);
  else if (field === "kind") {
    object.kind = event.target.value;
    if (object.kind === "sprite" && !object.asset) {
      object.asset = { packId: state.catalog.packs[0].id, tileIndex: 0 };
      object.width = 4;
      object.height = 4;
    } else if (object.kind !== "sprite") {
      delete object.asset;
    }
    const isSemantic = ["venue", "building"].includes(object.kind);
    if (wasSemantic && !isSemantic) removeSimulationReferences(candidate, object.id);
    if (!wasSemantic && isSemantic) markDisplayOnly(candidate, object.id);
  } else if (field === "layer") object.layer = event.target.value;
  else if (field === "variant") object.variant = event.target.value.trim();
  else if (field === "labelZh" || field === "labelEn") {
    object.label ||= { zh: "", en: "" };
    object.label[field === "labelZh" ? "zh" : "en"] = event.target.value;
  } else if (field === "simulationStatus") {
    if (event.target.value === "display_only") {
      markDisplayOnly(candidate, object.id);
    } else {
      const sourceBuildingId = dom.fieldSourceBuildingId.value.trim();
      if (!sourceBuildingId) {
        showToast(t("editor.sourceRequired"));
        syncInspector();
        return;
      }
      mapSourceBuilding(candidate, object.id, sourceBuildingId);
    }
  } else if (field === "sourceBuildingId") {
    const sourceBuildingId = event.target.value.trim();
    if (sourceBuildingId) mapSourceBuilding(candidate, object.id, sourceBuildingId);
    else markDisplayOnly(candidate, object.id);
  }

  const validation = validateMap(candidate, state.catalog);
  if (!validation.valid) {
    showToast(t("editor.changeRejected", { error: validation.errors[0] }));
    syncInspector();
    return;
  }
  recordHistory();
  state.map = candidate;
  state.selectedId = object.id;
  renderEditor();
}

function installEventHandlers() {
  dom.assetSearch.addEventListener("input", renderTilePalette);
  dom.assetCategory.addEventListener("change", renderTilePalette);
  dom.snapToggle.addEventListener("change", () => {
    state.snap = dom.snapToggle.checked;
    dom.editorWorld.classList.toggle("no-grid", !state.snap);
  });
  dom.zoomControl.addEventListener("input", updateZoom);

  dom.editorWorld.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  dom.editorWorld.addEventListener("drop", (event) => {
    event.preventDefault();
    try {
      const serialized = event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");
      addPayload(JSON.parse(serialized), pointerToWorld(event.clientX, event.clientY));
    } catch (error) {
      showToast(t("editor.dropFailed", { error: error.message }));
    }
  });
  dom.editorWorld.addEventListener("pointerdown", (event) => {
    const mapObject = event.target.closest("[data-map-object-id]");
    if (!mapObject) {
      setSelected(null);
      return;
    }
    setSelected(mapObject.dataset.mapObjectId);
    startGesture(event, "move");
  });
  dom.selectionOverlay.querySelectorAll("[data-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startGesture(event, "resize", handle.dataset.resize));
  });
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", endGesture);
  document.addEventListener("pointercancel", endGesture);

  dom.inspectorForm.addEventListener("change", onInspectorChange);
  dom.undoButton.addEventListener("click", undo);
  dom.redoButton.addEventListener("click", redo);
  dom.duplicateButton.addEventListener("click", duplicateSelected);
  dom.deleteButton.addEventListener("click", deleteSelected);
  dom.rotateButton.addEventListener("click", rotateSelected);
  dom.frontButton.addEventListener("click", () => moveLayerOrder(true));
  dom.backButton.addEventListener("click", () => moveLayerOrder(false));
  dom.exportButton.addEventListener("click", exportMap);
  dom.resetButton.addEventListener("click", () => {
    if (!window.confirm(t("editor.resetConfirm"))) return;
    recordHistory();
    state.map = cloneMap(state.defaultMap);
    state.selectedId = null;
    renderEditor();
    showToast(t("editor.resetDone"));
  });
  dom.previewButton.addEventListener("click", () => {
    saveDraft();
    window.open("./index.html?map=draft", "_blank", "noopener");
  });
  dom.mapFile.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const map = JSON.parse(await file.text());
      const validation = validateMap(map, state.catalog);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      recordHistory();
      state.map = cloneMap(map);
      state.selectedId = null;
      renderEditor();
      showToast(t("editor.imported", { file: file.name }));
    } catch (error) {
      showToast(t("editor.importFailed", { error: error.message }));
    } finally {
      event.target.value = "";
    }
  });

  document.addEventListener("keydown", (event) => {
    const editing = event.target.matches("input, select, textarea");
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (editing || !selectedObject()) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (command && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelected();
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const distance = event.shiftKey ? 5 : Number(state.map.world.grid || 1);
      updateSelected((object) => {
        if (event.key === "ArrowLeft") object.x = clamp(object.x - distance, 0, state.map.world.width - object.width);
        if (event.key === "ArrowRight") object.x = clamp(object.x + distance, 0, state.map.world.width - object.width);
        if (event.key === "ArrowUp") object.y = clamp(object.y - distance, 0, state.map.world.height - object.height);
        if (event.key === "ArrowDown") object.y = clamp(object.y + distance, 0, state.map.world.height - object.height);
      });
    }
  });
}

window.addEventListener("i18n:change", ({ detail }) => {
  state.renderer?.setLanguage(detail.language);
  if (!state.catalog) return;
  const selectedCategory = dom.assetCategory.value || "all";
  renderSemanticPalette();
  renderPackTabs();
  renderCategoryOptions();
  if ([...dom.assetCategory.options].some((option) => option.value === selectedCategory)) {
    dom.assetCategory.value = selectedCategory;
  }
  renderTilePalette();
  syncInspector();
  if (state.lastSavedAt) {
    const locale = getLanguage() === "zh" ? "zh-CN" : "en-US";
    const time = state.lastSavedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dom.draftStatus.textContent = t("editor.saved", { time });
  }
});

async function boot() {
  state.catalog = await loadAssetCatalog(ASSET_CATALOG_URL);
  state.defaultMap = await loadMap(DEFAULT_MAP_URL, state.catalog);
  state.selectedPackId = state.catalog.packs[0]?.id || null;
  renderSemanticPalette();
  renderPackTabs();
  renderCategoryOptions();
  renderTilePalette();
  installEventHandlers();
  updateZoom();

  let initialMap = state.defaultMap;
  let message = t("editor.defaultLoaded");
  const storedDraft = window.localStorage.getItem(MAP_DRAFT_KEY);
  const legacyDraft = window.localStorage.getItem(LEGACY_MAP_DRAFT_KEY);
  if (storedDraft) {
    try {
      const draft = JSON.parse(storedDraft);
      const validation = validateMap(draft, state.catalog);
      if (!validation.valid) throw new Error(validation.errors.join("; "));
      initialMap = draft;
      message = t("editor.draftRestored");
    } catch (error) {
      showToast(t("editor.invalidDraftIgnored", { error: error.message }));
    }
  } else if (legacyDraft) {
    message = t("editor.legacyDraft");
  }
  installMap(initialMap, { clearHistory: true, message });
}

boot().catch((error) => {
  console.error(error);
  dom.draftStatus.textContent = t("editor.bootFailed");
  showToast(t("editor.bootError", { error: error.message }));
});
