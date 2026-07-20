import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasTranslation } from "../i18n.js";

const root = new URL("..", import.meta.url);
const files = ["index.html", "editor.html", "characters.html", "app.js", "editor.js", "characters.js", "map-renderer.js"];
const referenced = new Set([
  "viewer.tone.mutual",
  "viewer.tone.approach",
  "viewer.tone.safety",
  "viewer.tone.neutral",
  "viewer.stage.unknown",
  "viewer.evidence.verified",
  "viewer.evidence.unsupported",
  "viewer.evidence.ambiguous",
  "viewer.evidence.not_claimed",
  "viewer.evidence.unclaimed_evidence",
]);

for (const file of files) {
  const source = await readFile(new URL(file, root), "utf8");
  for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) referenced.add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) referenced.add(match[1]);
}

for (const key of referenced) {
  assert.ok(hasTranslation(key, "en"), `English translation missing: ${key}`);
  assert.ok(hasTranslation(key, "zh"), `Chinese translation missing: ${key}`);
}

console.log(`i18n contract passed (${referenced.size} keys)`);
