import {
  CHARACTER_DIRECTIONS,
  CHARACTER_SERIES,
  applyCharacterSpriteStyle,
  characterTileIndex,
  normalizeCharacterAppearance,
  readCharacterRoster,
  writeCharacterRoster,
} from "./character-sprites.js";
import { bindLanguageControls, initI18n, t } from "./i18n.js";

initI18n();
bindLanguageControls();

const dom = {
  form: document.querySelector("#character-form"),
  id: document.querySelector("#character-id"),
  name: document.querySelector("#character-name"),
  role: document.querySelector("#character-role"),
  gender: document.querySelector("#character-gender"),
  preview: document.querySelector("#character-preview-sprite"),
  previewId: document.querySelector("#preview-id"),
  animate: document.querySelector("#animate-character"),
  frameControls: document.querySelector("#frame-controls"),
  directionControls: document.querySelector("#direction-controls"),
  seriesGrid: document.querySelector("#series-grid"),
  json: document.querySelector("#character-json"),
  tileReadout: document.querySelector("#tile-readout"),
  randomize: document.querySelector("#randomize-character"),
  save: document.querySelector("#save-character"),
  remove: document.querySelector("#remove-character"),
  copy: document.querySelector("#copy-character"),
  download: document.querySelector("#download-character"),
  roster: document.querySelector("#roster-list"),
  toast: document.querySelector("#character-toast"),
};

const state = {
  appearance: normalizeCharacterAppearance({ spriteId: "sprite-1", direction: "front", frame: 1 }),
  previewFrame: 1,
  roster: readCharacterRoster(),
  animationTimer: null,
};

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  window.setTimeout(() => dom.toast.classList.remove("is-visible"), 2600);
}

function characterData() {
  return {
    schemaVersion: 1,
    id: Number(dom.id.value) || 1,
    name: dom.name.value.trim() || `Agent ${Number(dom.id.value) || 1}`,
    role: dom.role.value.trim() || "participant",
    profile: { gender: dom.gender.value },
    appearance: { ...state.appearance },
  };
}

function setAppearance(next) {
  state.appearance = normalizeCharacterAppearance({ ...state.appearance, ...next });
  state.previewFrame = state.appearance.frame;
  render();
}

function makeChoiceButton(label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.classList.toggle("is-active", active);
  button.addEventListener("click", onClick);
  return button;
}

function renderSeries() {
  dom.seriesGrid.replaceChildren();
  CHARACTER_SERIES.forEach((series) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "series-card";
    button.dataset.spriteId = series.id;
    button.classList.toggle("is-active", state.appearance.spriteId === series.id);
    const sprite = document.createElement("span");
    applyCharacterSpriteStyle(sprite, { spriteId: series.id, direction: "front", frame: 1 });
    const label = document.createElement("small");
    label.textContent = series.id;
    button.append(sprite, label);
    button.addEventListener("click", () => setAppearance({ spriteId: series.id }));
    dom.seriesGrid.append(button);
  });
}

function renderControls() {
  dom.frameControls.replaceChildren();
  [0, 1, 2].forEach((frame) => {
    const button = makeChoiceButton(
      String(frame + 1),
      state.appearance.frame === frame,
      () => setAppearance({ frame }),
    );
    button.dataset.frame = String(frame);
    dom.frameControls.append(button);
  });
  dom.directionControls.replaceChildren();
  CHARACTER_DIRECTIONS.forEach((direction) => {
    const button = makeChoiceButton(
      t(`character.direction.${direction.id}`),
      state.appearance.direction === direction.id,
      () => setAppearance({ direction: direction.id }),
    );
    button.dataset.direction = direction.id;
    dom.directionControls.append(button);
  });
}

function renderRoster() {
  dom.roster.replaceChildren();
  if (state.roster.length === 0) {
    const empty = document.createElement("div");
    empty.className = "roster-empty";
    empty.textContent = t("character.rosterEmpty");
    dom.roster.append(empty);
    return;
  }
  [...state.roster].sort((a, b) => Number(a.id) - Number(b.id)).forEach((character) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "roster-item";
    const sprite = document.createElement("span");
    sprite.className = "roster-item-sprite";
    applyCharacterSpriteStyle(sprite, character.appearance);
    const copy = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = character.name;
    const meta = document.createElement("small");
    meta.textContent = `#${character.id} · ${character.appearance.spriteId}`;
    copy.append(name, meta);
    const load = document.createElement("small");
    load.textContent = t("character.load");
    button.append(sprite, copy, load);
    button.addEventListener("click", () => loadCharacter(character));
    dom.roster.append(button);
  });
}

function renderPreview() {
  applyCharacterSpriteStyle(dom.preview, { ...state.appearance, frame: state.previewFrame });
  const character = characterData();
  dom.preview.setAttribute("aria-label", `${character.name} / ${state.appearance.spriteId}`);
  dom.previewId.textContent = `#${String(character.id).padStart(3, "0")} / ${state.appearance.spriteId}`;
  dom.tileReadout.textContent = `TILE ${String(characterTileIndex({ ...state.appearance, frame: state.previewFrame })).padStart(4, "0")}`;
  dom.json.textContent = JSON.stringify(character, null, 2);
}

function render() {
  renderSeries();
  renderControls();
  renderPreview();
  renderRoster();
}

function loadCharacter(character) {
  dom.id.value = character.id;
  dom.name.value = character.name || `Agent ${character.id}`;
  dom.role.value = character.role || "participant";
  dom.gender.value = character.profile?.gender || "neutral";
  setAppearance(character.appearance);
}

function saveCharacter() {
  const character = characterData();
  const index = state.roster.findIndex((item) => String(item.id) === String(character.id));
  if (index >= 0) state.roster[index] = character;
  else state.roster.push(character);
  writeCharacterRoster(state.roster);
  renderRoster();
  showToast(t("character.saved", { id: character.id }));
}

function removeCharacter() {
  const id = Number(dom.id.value) || 1;
  state.roster = state.roster.filter((item) => String(item.id) !== String(id));
  writeCharacterRoster(state.roster);
  renderRoster();
  showToast(t("character.removed", { id }));
}

function randomizeCharacter() {
  const series = CHARACTER_SERIES[Math.floor(Math.random() * CHARACTER_SERIES.length)];
  const direction = CHARACTER_DIRECTIONS[Math.floor(Math.random() * CHARACTER_DIRECTIONS.length)];
  setAppearance({ spriteId: series.id, direction: direction.id, frame: 1 });
}

function downloadCharacter() {
  const character = characterData();
  const blob = new Blob([`${JSON.stringify(character, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `character-${character.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(t("character.downloaded"));
}

async function copyCharacter() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(characterData(), null, 2));
    showToast(t("character.copied"));
  } catch {
    showToast(t("character.copyFailed"));
  }
}

function startAnimation() {
  window.clearInterval(state.animationTimer);
  if (!dom.animate.checked) {
    state.previewFrame = state.appearance.frame;
    renderPreview();
    return;
  }
  state.animationTimer = window.setInterval(() => {
    state.previewFrame = (state.previewFrame + 1) % 3;
    renderPreview();
  }, 420);
}

dom.form.addEventListener("input", renderPreview);
dom.animate.addEventListener("change", startAnimation);
dom.randomize.addEventListener("click", randomizeCharacter);
dom.save.addEventListener("click", saveCharacter);
dom.remove.addEventListener("click", removeCharacter);
dom.download.addEventListener("click", downloadCharacter);
dom.copy.addEventListener("click", copyCharacter);
window.addEventListener("i18n:change", render);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.clearInterval(state.animationTimer);
  else startAnimation();
});

render();
startAnimation();
