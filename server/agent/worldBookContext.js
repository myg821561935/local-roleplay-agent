const GENERATION_TYPES = new Set([
  'normal',
  'continue',
  'impersonate',
  'swipe',
  'regenerate',
  'quiet'
]);

const ADDITIONAL_SOURCE_FIELDS = [
  ['matchPersonaDescription', 'match_persona_description', 'personaDescription'],
  ['matchCharacterDescription', 'match_character_description', 'characterDescription'],
  ['matchCharacterPersonality', 'match_character_personality', 'characterPersonality'],
  ['matchCharacterDepthPrompt', 'match_character_depth_prompt', 'characterDepthPrompt'],
  ['matchScenario', 'match_scenario', 'scenario'],
  ['matchCreatorNotes', 'match_creator_notes', 'creatorNotes']
];

export function buildWorldBookScanContext({
  generationType,
  characterCard,
  persona,
  groupMembers,
  targetSpeaker
} = {}) {
  const activeCharacter = resolveActiveCharacter({ characterCard, groupMembers, targetSpeaker });
  return {
    generationType: normalizeGenerationType(generationType),
    characters: resolveCharacterIdentities({ characterCard, groupMembers, targetSpeaker }),
    additionalSources: {
      personaDescription: persona?.enabled === false ? '' : stringValue(persona?.description),
      characterDescription: stringValue(activeCharacter?.description),
      characterPersonality: stringValue(activeCharacter?.personality),
      characterDepthPrompt: resolveCharacterDepthPrompt(activeCharacter),
      scenario: stringValue(activeCharacter?.scenario),
      creatorNotes: stringValue(activeCharacter?.creatorNotes ?? activeCharacter?.creator_notes)
    }
  };
}

export function normalizeGenerationType(value) {
  const normalized = stringValue(value).toLowerCase();
  return GENERATION_TYPES.has(normalized) ? normalized : 'normal';
}

export function matchesWorldBookGenerationType(entry, generationType) {
  const triggers = normalizeStringArray(firstDefined(
    entry?.triggers,
    entry?.extensions?.triggers
  )).map((value) => value.toLowerCase());
  return triggers.length === 0 || triggers.includes(normalizeGenerationType(generationType));
}

export function matchesWorldBookCharacterFilter(entry, characters = []) {
  const filter = normalizeCharacterFilter(firstDefined(
    entry?.characterFilter,
    entry?.character_filter,
    entry?.extensions?.characterFilter,
    entry?.extensions?.character_filter
  ));
  if (!filter) return true;

  const identities = Array.isArray(characters) ? characters : [];
  const nameMatch = filter.names.length > 0 && identities.some((character) => (
    character.names.some((name) => filter.names.includes(name))
  ));
  const tagMatch = filter.tags.length > 0 && identities.some((character) => (
    character.tags.some((tag) => filter.tags.includes(tag))
  ));

  if (filter.isExclude) return !nameMatch && !tagMatch;
  return (filter.names.length === 0 || nameMatch)
    && (filter.tags.length === 0 || tagMatch);
}

export function appendWorldBookAdditionalSources(query, entry, scanContext) {
  const source = scanContext?.additionalSources || {};
  const additions = ADDITIONAL_SOURCE_FIELDS
    .filter(([camelName, snakeName]) => entryBoolean(entry, camelName, snakeName))
    .map(([, , sourceName]) => stringValue(source[sourceName]))
    .filter(Boolean);
  if (!additions.length) return String(query || '');
  return [String(query || ''), ...additions.map((text) => `\x01${text}`)]
    .filter(Boolean)
    .join('\n');
}

export function summarizeWorldBookScanContext(context = {}) {
  return {
    generationType: normalizeGenerationType(context.generationType),
    characterNames: (Array.isArray(context.characters) ? context.characters : [])
      .map((character) => character.displayName)
      .filter(Boolean),
    additionalSourceKinds: Object.entries(context.additionalSources || {})
      .filter(([, value]) => Boolean(stringValue(value)))
      .map(([key]) => key)
  };
}

function resolveActiveCharacter({ characterCard, groupMembers, targetSpeaker }) {
  const requested = canonicalValue(targetSpeaker);
  if (requested) {
    const member = (Array.isArray(groupMembers) ? groupMembers : [])
      .filter((item) => item && item.enabled !== false)
      .find((item) => characterAliases(item).includes(requested));
    if (member) return member;
    if (characterAliases(characterCard).includes(requested)) return characterCard;
  }
  return characterCard || null;
}

function resolveCharacterIdentities({ characterCard, groupMembers, targetSpeaker }) {
  const requested = canonicalValue(targetSpeaker);
  const enabledMembers = (Array.isArray(groupMembers) ? groupMembers : [])
    .filter((item) => item && item.enabled !== false);
  let active = [];
  if (requested) {
    active = [characterCard, ...enabledMembers]
      .filter(Boolean)
      .filter((item) => characterAliases(item).includes(requested));
  } else if (enabledMembers.length) {
    active = [characterCard, ...enabledMembers].filter(Boolean);
  } else if (characterCard) {
    active = [characterCard];
  }

  if (!active.length && requested) active = [{ name: String(targetSpeaker || '') }];
  const seen = new Set();
  return active.map((character) => {
    const names = characterAliases(character);
    const tags = characterTags(character);
    const key = `${names.join('|')}::${tags.join('|')}`;
    if (!names.length || seen.has(key)) return null;
    seen.add(key);
    return {
      displayName: stringValue(character?.name || character?.title || targetSpeaker),
      names,
      tags
    };
  }).filter(Boolean);
}

function characterAliases(character) {
  if (!character || typeof character !== 'object') return [];
  const stableNames = [
    character.name,
    character.title,
    character.id
  ];
  const sourceNames = [
    character.avatar,
    character.fileName,
    character.filename,
    character.sourceFileName,
    character.sourceName,
    character.extensions?.avatar,
    character.extensions?.fileName,
    character.extensions?.filename,
    character.extensions?.sourceFileName,
    character.extensions?.local_roleplay_agent?.sourceFileName
  ];
  return uniqueCanonicalValues([
    ...stableNames,
    ...sourceNames.flatMap(sourceNameVariants)
  ]);
}

function characterTags(character) {
  const values = [
    ...(Array.isArray(character?.tags) ? character.tags : []),
    ...(Array.isArray(character?.extensions?.tags) ? character.extensions.tags : [])
  ];
  return uniqueCanonicalValues(values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [value];
    return [value.id, value.name];
  }));
}

function normalizeCharacterFilter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const names = uniqueCanonicalValues(normalizeStringArray(value.names ?? value.characters));
  const rawTags = Array.isArray(value.tags)
    ? value.tags
    : (value.tags === undefined || value.tags === null ? [] : [value.tags]);
  const tags = uniqueCanonicalValues([...rawTags, ...normalizeStringArray(value.tagNames ?? value.tag_names)].flatMap((tag) => {
    if (!tag || typeof tag !== 'object') return [tag];
    return [tag.id, tag.name];
  }));
  const isExclude = booleanValue(value.isExclude ?? value.is_exclude ?? value.exclude);
  if (!names.length && !tags.length) return null;
  return { names, tags, isExclude };
}

function resolveCharacterDepthPrompt(character) {
  const depthPrompt = firstDefined(
    character?.characterDepthPrompt,
    character?.characterNote,
    character?.character_note,
    character?.depthPrompt,
    character?.depth_prompt,
    character?.extensions?.depthPrompt,
    character?.extensions?.depth_prompt
  );
  if (depthPrompt && typeof depthPrompt === 'object') {
    return stringValue(depthPrompt.prompt ?? depthPrompt.content ?? depthPrompt.text);
  }
  return stringValue(depthPrompt || character?.postHistoryInstructions);
}

function entryBoolean(entry, camelName, snakeName) {
  return booleanValue(firstDefined(
    entry?.[camelName],
    entry?.[snakeName],
    entry?.extensions?.[camelName],
    entry?.extensions?.[snakeName]
  ));
}

function normalizeStringArray(value) {
  const values = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  return values.map((item) => stringValue(item)).filter(Boolean);
}

function uniqueCanonicalValues(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => canonicalValue(value))
    .filter(Boolean))];
}

function sourceNameVariants(value) {
  const text = stringValue(value);
  if (!text) return [];
  const leaf = text.split(/[\\/]/).at(-1) || text;
  const withoutExtension = leaf.replace(/\.[^.]+$/, '');
  return [text, leaf, withoutExtension];
}

function canonicalValue(value) {
  return stringValue(value).normalize('NFKC').toLowerCase();
}

function booleanValue(value) {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

function stringValue(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}
