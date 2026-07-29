import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const [html, app, music] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  stat(new URL("../assets/audio/moon-and-sun.mp3", import.meta.url)),
]);

assert.match(html, /<audio id="background-music" preload="metadata" loop>/);
assert.doesNotMatch(html, /<audio[^>]*\bautoplay\b/);
assert.match(html, /src="\.\/assets\/audio\/moon-and-sun\.mp3"/);
assert.match(app, /dom\.backgroundMusic\.volume = 0\.32/);
assert.match(app, /await dom\.backgroundMusic\.play\(\)/);
assert.match(app, /dom\.backgroundMusic\.pause\(\)/);
assert.ok(music.size > 1_000_000);

console.log("background music contract passed");
