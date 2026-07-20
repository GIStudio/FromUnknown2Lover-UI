import assert from "node:assert/strict";
import {
  DEFAULT_LANGUAGE,
  getLanguage,
  hasTranslation,
  localizedValue,
  resolveInitialLanguage,
  setLanguage,
  t,
} from "../i18n.js";

assert.equal(resolveInitialLanguage(), DEFAULT_LANGUAGE);
assert.equal(resolveInitialLanguage({ stored: "zh" }), "zh");
assert.equal(resolveInitialLanguage({ search: "?lang=en", stored: "zh" }), "en");
assert.equal(resolveInitialLanguage({ search: "?lang=invalid", stored: "invalid" }), "en");

setLanguage("en", { persist: false, notify: false });
assert.equal(getLanguage(), "en");
assert.equal(t("viewer.mapEditor"), "Map editor");
assert.equal(t("viewer.bubblesPage", { page: 2, total: 4, turn: 3, turns: 6 }), "DIALOGUE 2/4 · 3/6");
assert.equal(t("viewer.stage.relationship_confirmed"), "RELATIONSHIP CONFIRMED");
assert.equal(t("viewer.roads"), "ROADS");
assert.equal(t("viewer.flow.normal"), "Normal");
assert.equal(t("viewer.guideOpen"), "Guide");
assert.equal(t("viewer.timelineEvent", { step: "03", time: "18:20", count: 2, turns: 8 }), "Step 03, 18:20: 2 playable dialogue events and 8 turns");
assert.ok(hasTranslation("editor.field.x", "en"));
assert.equal(localizedValue({ en: "CENTRAL PARK", zh: "中央公园" }), "CENTRAL PARK");

setLanguage("zh", { persist: false, notify: false });
assert.equal(t("viewer.mapEditor"), "地图编辑器");
assert.equal(t("viewer.roads"), "沿道路");
assert.equal(t("viewer.flow.normal"), "普通");
assert.equal(t("viewer.guideOpen"), "使用指南");
assert.equal(t("editor.field.y"), "Y 坐标");
assert.equal(t("viewer.stage.relationship_confirmed"), "确认情侣关系");
assert.equal(localizedValue({ en: "CENTRAL PARK", zh: "中央公园" }), "中央公园");

setLanguage("unsupported", { persist: false, notify: false });
assert.equal(getLanguage(), "en");

console.log("i18n tests passed");
