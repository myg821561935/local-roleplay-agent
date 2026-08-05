export const NARRATIVE_MODES = Object.freeze(['free', 'stable', 'strict']);
export const ROLEPLAY_MODES = Object.freeze(['dialogue', 'dm', 'protagonist', 'director', 'commentary']);
export const RESPONSE_LENGTH_MODES = Object.freeze(['compact', 'balanced', 'long']);

export const NARRATIVE_MODE_LABELS = Object.freeze({
  free: '自由路线',
  stable: '稳定路线',
  strict: '严格路线'
});

export const ROLEPLAY_MODE_LABELS = Object.freeze({
  dialogue: '对白流',
  dm: '标准 DM 叙事流',
  protagonist: '叙事子流派',
  director: '导演 / 共创流',
  commentary: '旁白解说流'
});

export const RESPONSE_LENGTH_LABELS = Object.freeze({
  compact: '紧凑推进',
  balanced: '标准推进',
  long: '长篇推进'
});

export function normalizeNarrativeMode(mode) {
  return NARRATIVE_MODES.includes(mode) ? mode : 'stable';
}

export function normalizeRoleplayMode(mode) {
  return ROLEPLAY_MODES.includes(mode) ? mode : 'dm';
}

export function normalizeResponseLength(mode) {
  return RESPONSE_LENGTH_MODES.includes(mode) ? mode : 'balanced';
}
