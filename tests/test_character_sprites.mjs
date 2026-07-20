import assert from "node:assert/strict";
import {
  CHARACTER_SERIES,
  characterTileIndex,
  normalizeCharacterAppearance,
} from "../character-sprites.js";

assert.equal(CHARACTER_SERIES.length, 6);
assert.equal(characterTileIndex({ spriteId: "sprite-1", direction: "front", frame: 1 }), 51);
assert.equal(characterTileIndex({ spriteId: "sprite-6", direction: "front", frame: 1 }), 456);
assert.equal(characterTileIndex({ spriteId: "sprite-6", direction: "right", frame: 2 }), 485);
assert.deepEqual(
  normalizeCharacterAppearance({ spriteId: "missing", direction: "missing", frame: 99 }),
  { packId: "kenney-rpg-urban", spriteId: "sprite-1", direction: "front", frame: 2 },
);

console.log("character sprite tests passed");
