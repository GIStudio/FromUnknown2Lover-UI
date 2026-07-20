import { getLanguage, localizedValue, t } from "./i18n.js?v=20260720-timeline-guide";

export const DEFAULT_MAP_URL = "./data/map.json";
export const ASSET_CATALOG_URL = "./assets/catalog.json";
export const MAP_DRAFT_KEY = "fromunknown2lover:map-editor:draft:v2";
export const LEGACY_MAP_DRAFT_KEY = "fromunknown2lover:map-editor:draft:v1";

const SUPPORTED_KINDS = new Set([
  "road",
  "rail",
  "crosswalk",
  "venue",
  "building",
  "label",
  "decor",
  "sprite",
]);

export function cloneMap(map) {
  return JSON.parse(JSON.stringify(map));
}

export async function loadAssetCatalog(url = ASSET_CATALOG_URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(t("map.catalogReadFailed", { status: response.status }));
  const catalog = await response.json();
  if (!catalog || !Array.isArray(catalog.packs)) throw new Error(t("map.catalogMissingPacks"));
  return catalog;
}

export function assetPackById(catalog, packId) {
  return catalog?.packs?.find((pack) => pack.id === packId) || null;
}

export function applySpriteStyle(element, pack, tileIndex) {
  if (!pack || !Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= pack.count) {
    element.classList.add("sprite-missing");
    return;
  }
  const column = tileIndex % pack.columns;
  const row = Math.floor(tileIndex / pack.columns);
  const atlasWidth = pack.columns * pack.tileSize + (pack.columns - 1) * pack.spacing;
  const atlasHeight = pack.rows * pack.tileSize + (pack.rows - 1) * pack.spacing;
  const xPosition = pack.columns <= 1 ? 0 : (column / (pack.columns - 1)) * 100;
  const yPosition = pack.rows <= 1 ? 0 : (row / (pack.rows - 1)) * 100;
  element.style.backgroundImage = `url("${pack.src}")`;
  element.style.backgroundSize = `${(atlasWidth / pack.tileSize) * 100}% ${(atlasHeight / pack.tileSize) * 100}%`;
  element.style.backgroundPosition = `${xPosition}% ${yPosition}%`;
  element.style.backgroundRepeat = "no-repeat";
  element.style.imageRendering = "pixelated";
}

export function validateMap(map, catalog = null) {
  const errors = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return { valid: false, errors: [t("map.validation.object")] };
  }
  if (map.schemaVersion !== 2) errors.push(t("map.validation.schema"));
  if (!String(map.id || "").trim()) errors.push(t("map.validation.id"));

  const world = map.world || {};
  const worldWidth = Number(world.width);
  const worldHeight = Number(world.height);
  if (!(worldWidth > 0) || !(worldHeight > 0)) errors.push(t("map.validation.worldSize"));
  if (!(Number(world.grid) > 0)) errors.push(t("map.validation.grid"));
  if (world.unit !== "m") errors.push(t("map.validation.unit"));

  if (!Array.isArray(map.layers) || map.layers.length === 0) errors.push(t("map.validation.layers"));
  if (!Array.isArray(map.objects)) errors.push(t("map.validation.objects"));

  const layerIds = new Set();
  (map.layers || []).forEach((layer, index) => {
    const id = String(layer?.id || "").trim();
    if (!id) errors.push(t("map.validation.missingId", { target: `layers[${index}]` }));
    else if (layerIds.has(id)) errors.push(t("map.validation.duplicateLayer", { id }));
    else layerIds.add(id);
    if (!Number.isFinite(Number(layer?.z))) errors.push(t("map.validation.invalidLayerZ", { id: id || index }));
  });

  const objectIds = new Set();
  (map.objects || []).forEach((object, index) => {
    const prefix = `objects[${index}]`;
    const id = String(object?.id || "").trim();
    if (!id) errors.push(t("map.validation.missingId", { target: prefix }));
    else if (objectIds.has(id)) errors.push(t("map.validation.duplicateObject", { id }));
    else objectIds.add(id);
    if (!layerIds.has(object?.layer)) errors.push(t("map.validation.unknownLayer", { id: id || prefix, layer: object?.layer }));
    if (!SUPPORTED_KINDS.has(object?.kind)) errors.push(t("map.validation.unsupportedKind", { id: id || prefix, kind: object?.kind }));

    const x = Number(object?.x);
    const y = Number(object?.y);
    const width = Number(object?.width);
    const height = Number(object?.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      errors.push(t("map.validation.invalidGeometry", { id: id || prefix }));
    } else if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > worldWidth + 0.0001 || y + height > worldHeight + 0.0001) {
      errors.push(t("map.validation.outOfBounds", { id: id || prefix }));
    }

    if (object?.shape?.type === "polygon") {
      const points = object.shape.points;
      if (!Array.isArray(points) || points.length < 3) {
        errors.push(t("map.validation.polygonPoints", { id: id || prefix }));
      } else if (points.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100))) {
        errors.push(t("map.validation.polygonRange", { id: id || prefix }));
      }
    }

    if (object?.kind === "sprite") {
      const pack = assetPackById(catalog, object.asset?.packId);
      if (!object.asset?.packId) errors.push(t("map.validation.missingPack", { id: id || prefix }));
      else if (catalog && !pack) errors.push(t("map.validation.unknownPack", { id: id || prefix, pack: object.asset.packId }));
      const tileIndex = Number(object.asset?.tileIndex);
      if (!Number.isInteger(tileIndex) || tileIndex < 0 || (pack && tileIndex >= pack.count)) {
        errors.push(t("map.validation.invalidTile", { id: id || prefix }));
      }
    }
  });

  const objectById = new Map((map.objects || []).map((object) => [object.id, object]));
  const simulation = map.simulation;
  if (!simulation || typeof simulation !== "object" || Array.isArray(simulation)) {
    errors.push(t("map.validation.simulation"));
  } else {
    const mappings = simulation.buildingMappings;
    const displayOnlyIds = simulation.displayOnlyObjectIds;
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      errors.push(t("map.validation.mappingsType"));
    }
    if (!Array.isArray(displayOnlyIds)) {
      errors.push(t("map.validation.displayOnlyType"));
    }

    const mappedObjectIds = new Set();
    Object.entries(mappings || {}).forEach(([sourceId, mapObjectId]) => {
      if (!String(sourceId).trim()) errors.push(t("map.validation.emptySource"));
      if (!String(mapObjectId || "").trim()) {
        errors.push(t("map.validation.missingMapObject", { source: sourceId }));
        return;
      }
      if (mappedObjectIds.has(mapObjectId)) errors.push(t("map.validation.duplicateMapping", { id: mapObjectId }));
      mappedObjectIds.add(mapObjectId);
      const object = objectById.get(mapObjectId);
      if (!object) errors.push(t("map.validation.unknownMapping", { source: sourceId, id: mapObjectId }));
      else if (!["venue", "building"].includes(object.kind)) errors.push(t("map.validation.mappingKind", { id: mapObjectId }));
    });

    const displayOnlySet = new Set();
    (displayOnlyIds || []).forEach((objectId) => {
      if (displayOnlySet.has(objectId)) errors.push(t("map.validation.duplicateDisplayOnly", { id: objectId }));
      displayOnlySet.add(objectId);
      const object = objectById.get(objectId);
      if (!object) errors.push(t("map.validation.unknownDisplayOnly", { id: objectId }));
      else if (!["venue", "building"].includes(object.kind)) errors.push(t("map.validation.displayOnlyKind", { id: objectId }));
      if (mappedObjectIds.has(objectId)) errors.push(t("map.validation.statusConflict", { id: objectId }));
    });

    (map.objects || [])
      .filter((object) => ["venue", "building"].includes(object.kind))
      .forEach((object) => {
        if (!mappedObjectIds.has(object.id) && !displayOnlySet.has(object.id)) {
          errors.push(t("map.validation.missingStatus", { id: object.id }));
        }
      });
  }

  return { valid: errors.length === 0, errors };
}

export function simulationStatusForObject(map, objectId) {
  const mappings = map?.simulation?.buildingMappings || {};
  const sourceBuildingId = Object.entries(mappings).find(([, mappedId]) => mappedId === objectId)?.[0] || null;
  if (sourceBuildingId) return { status: "mapped", sourceBuildingId };
  if ((map?.simulation?.displayOnlyObjectIds || []).includes(objectId)) {
    return { status: "display_only", sourceBuildingId: null };
  }
  return { status: "not_applicable", sourceBuildingId: null };
}

export function mappedObjectForBuilding(map, sourceBuildingId) {
  const objectId = map?.simulation?.buildingMappings?.[sourceBuildingId];
  return objectId ? map.objects.find((object) => object.id === objectId) || null : null;
}

export function worldValueToPercent(value, extent) {
  const numericExtent = Number(extent);
  return numericExtent > 0 ? (Number(value) / numericExtent) * 100 : 0;
}

export async function loadMap(url = DEFAULT_MAP_URL, catalog = null) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(t("map.readFailed", { status: response.status }));
  const map = await response.json();
  const validation = validateMap(map, catalog);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return map;
}

function createElement(className) {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function appendVenueLabel(element, label, language) {
  if (!label?.zh && !label?.en) return;
  const labelElement = document.createElement("span");
  labelElement.className = "venue-label";
  labelElement.textContent = localizedValue(label, language);
  if (language === "zh" && label.en) {
    const small = document.createElement("small");
    small.textContent = String(label.en);
    labelElement.append(small);
  }
  element.append(labelElement);
}

function appendSimulationBadge(element, status) {
  if (status !== "display_only") return;
  const badge = document.createElement("span");
  badge.className = "non-simulation-badge";
  badge.textContent = t("map.displayOnly");
  element.append(badge);
}

function appendBuilding(element, variant) {
  const building = createElement(`building building-${variant || "generic"}`);
  const windowCount = {
    cultural: 1,
    dining: 2,
    residential: 3,
    "night-school": 1,
    performance: 1,
    service: 1,
    bar: 1,
    entertainment: 1,
    sports: 1,
    workshop: 1,
  }[variant] || 0;
  for (let index = 0; index < windowCount; index += 1) building.append(document.createElement("i"));
  element.append(building);
}

function appendVenueDetails(element, variant) {
  if (variant === "creative-court") {
    element.append(createElement("court-lines"), createElement("sunken-court court-a"), createElement("sunken-court court-b"));
    return;
  }
  if (variant === "night-market") {
    const stalls = createElement("market-stalls");
    for (let index = 0; index < 6; index += 1) stalls.append(document.createElement("i"));
    element.append(stalls, createElement("market-stage"));
    return;
  }
  if (variant === "central-park") {
    const gathering = createElement("park-gathering");
    for (let index = 0; index < 3; index += 1) gathering.append(document.createElement("i"));
    element.append(createElement("park-loop"), createElement("park-lawn"), gathering);
    return;
  }
  appendBuilding(element, variant);
}

function appendRailDetails(element) {
  element.append(document.createElement("i"), document.createElement("i"));
}

function applyObjectGeometry(element, object, layerZ, world) {
  element.style.left = `${worldValueToPercent(object.x, world.width)}%`;
  element.style.top = `${worldValueToPercent(object.y, world.height)}%`;
  element.style.width = `${worldValueToPercent(object.width, world.width)}%`;
  element.style.height = `${worldValueToPercent(object.height, world.height)}%`;
  element.style.zIndex = String(Number(layerZ || 0) + Number(object.z || 0));
  element.style.transform = `rotate(${Number(object.rotation || 0)}deg)`;
  if (object.shape?.type === "polygon" && Array.isArray(object.shape.points)) {
    const points = object.shape.points.map(([x, y]) => `${x}% ${y}%`).join(", ");
    element.style.clipPath = `polygon(${points})`;
  }
  if (object.style?.fill) element.style.backgroundColor = String(object.style.fill);
}

function renderObject(object, layer, catalog, map, language) {
  let element;
  const variant = String(object.variant || "generic");

  if (object.kind === "rail") {
    element = createElement("map-object rail-corridor");
    appendRailDetails(element);
  } else if (object.kind === "road") {
    element = createElement(`map-object road ${variant === "horizontal" ? "road-h" : "road-v"}`);
  } else if (object.kind === "crosswalk") {
    element = createElement("map-object crosswalk");
  } else if (object.kind === "venue") {
    element = createElement(`map-object venue venue-${variant}`);
    appendVenueDetails(element, variant);
    appendVenueLabel(element, object.label, language);
  } else if (object.kind === "building") {
    element = createElement("map-object map-generic-building");
    appendBuilding(element, "generic");
    appendVenueLabel(element, object.label, language);
  } else if (object.kind === "label") {
    element = createElement("map-object map-label-object");
    appendVenueLabel(element, object.label, language);
  } else if (object.kind === "decor" && variant === "tree-row") {
    element = createElement("map-object tree-row");
  } else if (object.kind === "decor" && variant === "car") {
    element = createElement("map-object car");
  } else if (object.kind === "sprite") {
    element = createElement("map-object map-sprite");
    applySpriteStyle(element, assetPackById(catalog, object.asset?.packId), Number(object.asset?.tileIndex));
    element.title = `${object.asset?.packId || "unknown"} / ${object.asset?.tileIndex ?? "?"}`;
  } else {
    element = createElement(`map-object map-generic-decor decor-${variant}`);
  }

  const simulation = simulationStatusForObject(map, object.id);
  if (simulation.status === "display_only") element.classList.add("is-display-only");
  appendSimulationBadge(element, simulation.status);
  element.dataset.mapObjectId = object.id;
  element.dataset.mapKind = object.kind;
  element.dataset.mapLayer = object.layer;
  element.dataset.simulationStatus = simulation.status;
  if (simulation.sourceBuildingId) element.dataset.sourceBuildingId = simulation.sourceBuildingId;
  element.setAttribute("aria-label", localizedValue(object.label, language) || object.id);
  applyObjectGeometry(element, object, layer.z, map.world);
  return element;
}

export class MapRenderer {
  constructor(container, map, options = {}) {
    this.container = container;
    this.map = map;
    this.catalog = options.catalog || null;
    this.editable = Boolean(options.editable);
    this.selectedId = options.selectedId || null;
    this.language = options.language || getLanguage();
    this.root = null;
    this.render();
  }

  setMap(map, options = {}) {
    this.map = map;
    if (Object.hasOwn(options, "selectedId")) this.selectedId = options.selectedId;
    this.render();
  }

  setSelected(selectedId) {
    this.selectedId = selectedId;
    this.root?.querySelectorAll(".is-map-selected").forEach((element) => element.classList.remove("is-map-selected"));
    if (selectedId) this.root?.querySelector(`[data-map-object-id="${CSS.escape(selectedId)}"]`)?.classList.add("is-map-selected");
  }

  setLanguage(language = getLanguage()) {
    this.language = language;
    this.render();
  }

  render() {
    const validation = validateMap(this.map, this.catalog);
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    const layerById = new Map(this.map.layers.map((layer) => [layer.id, layer]));
    const root = createElement("map-render-root");
    root.dataset.mapId = this.map.id;
    root.setAttribute("aria-hidden", this.editable ? "false" : "true");
    const fragment = document.createDocumentFragment();
    [...this.map.objects]
      .sort((left, right) => {
        const leftLayer = Number(layerById.get(left.layer)?.z || 0);
        const rightLayer = Number(layerById.get(right.layer)?.z || 0);
        return leftLayer + Number(left.z || 0) - rightLayer - Number(right.z || 0);
      })
      .forEach((object) => {
        const element = renderObject(object, layerById.get(object.layer), this.catalog, this.map, this.language);
        if (object.id === this.selectedId) element.classList.add("is-map-selected");
        fragment.append(element);
      });
    root.append(fragment);
    this.container.replaceChildren(root);
    this.root = root;
  }

  destroy() {
    this.container.replaceChildren();
    this.root = null;
  }
}

export function renderMap(container, map, options = {}) {
  return new MapRenderer(container, map, options);
}

export function renderMapError(container, message) {
  const error = document.createElement("div");
  error.className = "map-load-error";
  const title = document.createElement("strong");
  title.textContent = t("map.offline");
  const detail = document.createElement("span");
  detail.textContent = String(message || t("map.loadFailed"));
  error.append(title, detail);
  container.replaceChildren(error);
}
