const FEMALE_VALUES = new Set(["female", "woman", "girl", "f", "女", "女性"]);
const MALE_VALUES = new Set(["male", "man", "boy", "m", "男", "男性"]);

import { normalizeCharacterAppearance } from "./character-sprites.js";

const SERIES_BY_GENDER = {
  female: ["sprite-1", "sprite-2", "sprite-3"],
  male: ["sprite-4", "sprite-5", "sprite-6"],
  neutral: ["sprite-1", "sprite-2", "sprite-3", "sprite-4", "sprite-5", "sprite-6"],
};

function stableHash(value) {
  return [...String(value || "agent")].reduce((hash, character) => (
    (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0
  ), 2166136261);
}

export function normalizeGender(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (FEMALE_VALUES.has(normalized)) return "female";
  if (MALE_VALUES.has(normalized)) return "male";
  return "neutral";
}

export function genderFromAgent(agent, profile = agent?.profile || {}) {
  return normalizeGender(
    agent?.gender
      ?? agent?.sex
      ?? profile?.gender
      ?? profile?.sex
      ?? profile?.性别,
  );
}

export function buildAgentAppearance(agent, profile = agent?.profile || {}, override = null) {
  const gender = genderFromAgent(agent, profile);
  const hash = stableHash(`${agent?.id ?? ""}:${agent?.name ?? ""}`);
  const series = SERIES_BY_GENDER[gender];
  const generated = normalizeCharacterAppearance({
    spriteId: series[hash % series.length],
    direction: "front",
    frame: 1,
  });
  return {
    gender,
    ...generated,
    ...(override ? normalizeCharacterAppearance(override) : {}),
  };
}
