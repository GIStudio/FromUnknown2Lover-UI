export const CHARACTER_ROSTER_KEY = "fromunknown2lover:character-roster:v1";

export const CHARACTER_PACK = Object.freeze({
  id: "kenney-rpg-urban",
  src: "./assets/kenney-rpg-urban/tilemap.png",
  tileSize: 16,
  spacing: 1,
  columns: 27,
  rows: 18,
  count: 486,
});

export const CHARACTER_DIRECTIONS = Object.freeze([
  { id: "left", column: 23 },
  { id: "front", column: 24 },
  { id: "back", column: 25 },
  { id: "right", column: 26 },
]);

export const CHARACTER_SERIES = Object.freeze(Array.from({ length: 6 }, (_, index) => ({
  id: `sprite-${index + 1}`,
  series: index + 1,
  rowStart: index * 3,
  frameCount: 3,
})));

export function characterSeriesById(spriteId) {
  return CHARACTER_SERIES.find((series) => series.id === spriteId) || CHARACTER_SERIES[0];
}

export function normalizeCharacterAppearance(value = {}) {
  const sprite = characterSeriesById(value.spriteId);
  const direction = CHARACTER_DIRECTIONS.some((item) => item.id === value.direction)
    ? value.direction
    : "front";
  const frame = Math.min(2, Math.max(0, Number.isInteger(Number(value.frame)) ? Number(value.frame) : 1));
  return {
    packId: CHARACTER_PACK.id,
    spriteId: sprite.id,
    direction,
    frame,
  };
}

export function characterTileIndex(value = {}) {
  const appearance = normalizeCharacterAppearance(value);
  const series = characterSeriesById(appearance.spriteId);
  const direction = CHARACTER_DIRECTIONS.find((item) => item.id === appearance.direction);
  return (series.rowStart + appearance.frame) * CHARACTER_PACK.columns + direction.column;
}

export function applyCharacterSpriteStyle(element, value = {}) {
  const appearance = normalizeCharacterAppearance(value);
  const tileIndex = characterTileIndex(appearance);
  const column = tileIndex % CHARACTER_PACK.columns;
  const row = Math.floor(tileIndex / CHARACTER_PACK.columns);
  const atlasWidth = CHARACTER_PACK.columns * CHARACTER_PACK.tileSize + (CHARACTER_PACK.columns - 1) * CHARACTER_PACK.spacing;
  const atlasHeight = CHARACTER_PACK.rows * CHARACTER_PACK.tileSize + (CHARACTER_PACK.rows - 1) * CHARACTER_PACK.spacing;
  const xPosition = (column / (CHARACTER_PACK.columns - 1)) * 100;
  const yPosition = (row / (CHARACTER_PACK.rows - 1)) * 100;
  element.style.backgroundImage = `url("${CHARACTER_PACK.src}")`;
  element.style.backgroundSize = `${(atlasWidth / CHARACTER_PACK.tileSize) * 100}% ${(atlasHeight / CHARACTER_PACK.tileSize) * 100}%`;
  element.style.backgroundPosition = `${xPosition}% ${yPosition}%`;
  element.style.backgroundRepeat = "no-repeat";
  element.style.imageRendering = "pixelated";
  element.dataset.spriteId = appearance.spriteId;
  element.dataset.direction = appearance.direction;
  element.dataset.frame = String(appearance.frame);
  element.dataset.tileIndex = String(tileIndex);
  return appearance;
}

export function readCharacterRoster(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(CHARACTER_ROSTER_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id !== undefined) : [];
  } catch {
    return [];
  }
}

export function writeCharacterRoster(roster, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(CHARACTER_ROSTER_KEY, JSON.stringify(roster));
}
