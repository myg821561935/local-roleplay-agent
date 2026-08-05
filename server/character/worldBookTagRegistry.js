const UUID_TAG_ID = /^(?:tag[-_:])?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPACT_HASH_TAG_ID = /^(?:tag[-_:])?[0-9a-f]{24,64}$/i;

export function normalizeWorldBookTagRegistry(value = {}) {
  const candidates = [
    value?.tag_registry,
    value?.tagRegistry,
    value?.settings?.tags,
    value?.extensions?.tag_registry,
    value?.extensions?.tagRegistry,
    Array.isArray(value?.tags) && value.tags.some(isTagRecord) ? value.tags : null
  ];
  const byId = new Map();
  candidates.forEach((candidate) => collectRegistryEntries(candidate, byId));
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

export function resolveWorldBookCharacterFilter(value, { tagRegistry = [] } = {}) {
  if (!isRecord(value)) return { filter: null, mappings: [] };
  const registry = new Map(normalizeRegistryInput(tagRegistry).map((item) => [item.id, item.name]));
  const tags = [];
  const tagNames = [];
  const unresolvedTagIds = [];
  const mappings = new Map();
  const rawTags = Array.isArray(value.tags)
    ? value.tags
    : (value.tags === undefined || value.tags === null ? [] : [value.tags]);

  rawTags.forEach((tag) => {
    if (isRecord(tag)) {
      const id = stringValue(tag.id);
      const inlineName = stringValue(tag.name);
      const name = inlineName || registry.get(id) || '';
      if (id) tags.push(id);
      if (name) {
        tagNames.push(name);
        if (id) mappings.set(id, name);
      } else if (id && looksLikeExternalTagId(id)) {
        unresolvedTagIds.push(id);
      }
      return;
    }

    const reference = stringValue(tag);
    if (!reference) return;
    tags.push(reference);
    const mappedName = registry.get(reference) || '';
    if (mappedName) {
      tagNames.push(mappedName);
      mappings.set(reference, mappedName);
    } else if (looksLikeExternalTagId(reference)) {
      unresolvedTagIds.push(reference);
    } else {
      // 非不透明值视为可移植标签名，兼容其他编辑器直接写名称的扩展格式。
      tagNames.push(reference);
    }
  });

  const declaredTagNames = normalizeStringArray(value.tagNames ?? value.tag_names);
  tagNames.push(...declaredTagNames);
  if (Object.hasOwn(value, 'unresolvedTagIds') || Object.hasOwn(value, 'unresolved_tag_ids')) {
    normalizeStringArray(value.unresolvedTagIds ?? value.unresolved_tag_ids).forEach((id) => {
      const mappedName = registry.get(id) || '';
      if (mappedName) {
        tagNames.push(mappedName);
        mappings.set(id, mappedName);
      } else {
        unresolvedTagIds.push(id);
      }
    });
  }

  const filter = {
    isExclude: booleanValue(value.isExclude ?? value.is_exclude ?? value.exclude),
    names: uniqueStrings(normalizeStringArray(value.names ?? value.characters)),
    tags: uniqueStrings(tags),
    tagNames: uniqueStrings(tagNames),
    unresolvedTagIds: uniqueStrings(unresolvedTagIds)
  };
  return {
    filter,
    mappings: [...mappings.entries()].map(([id, name]) => ({ id, name }))
  };
}

export function inspectWorldBookCharacterFilterTags(value = {}) {
  const entries = readWorldBookEntries(value);
  const globalRegistry = normalizeWorldBookTagRegistry(value);
  const unresolved = [];
  const resolved = new Map();
  let filteredEntryCount = 0;

  entries.forEach((entry, index) => {
    const filter = firstDefined(
      entry?.characterFilter,
      entry?.character_filter,
      entry?.extensions?.characterFilter,
      entry?.extensions?.character_filter
    );
    if (!isRecord(filter)) return;
    filteredEntryCount += 1;
    const entryRegistry = normalizeRegistryInput([
      ...globalRegistry,
      ...(Array.isArray(entry?.extensions?.character_filter_tag_registry)
        ? entry.extensions.character_filter_tag_registry
        : [])
    ]);
    const resolution = resolveWorldBookCharacterFilter(filter, { tagRegistry: entryRegistry });
    resolution.mappings.forEach((item) => resolved.set(item.id, item.name));
    const title = stringValue(entry?.title || entry?.name || entry?.comment || entry?.id || entry?.uid)
      || `世界书条目 ${index + 1}`;
    resolution.filter?.unresolvedTagIds.forEach((id) => unresolved.push({ id, title }));
  });

  return {
    filteredEntryCount,
    resolvedMappings: [...resolved.entries()].map(([id, name]) => ({ id, name })),
    unresolved: dedupeUnresolved(unresolved)
  };
}

export function applyWorldBookTagRegistry(value = {}, {
  registryDocument = {},
  mappings = []
} = {}) {
  const payload = structuredClone(isRecord(value) ? value : { entries: [] });
  const suppliedRegistry = normalizeRegistryInput([
    ...normalizeWorldBookTagRegistry(registryDocument),
    ...normalizeRegistryInput(mappings)
  ]);
  const suppliedIds = new Set(suppliedRegistry.map((item) => item.id));
  const before = inspectWorldBookCharacterFilterTags(payload);
  const applied = new Map();
  let changedEntryCount = 0;

  readWorldBookEntries(payload).forEach((entry) => {
    if (!isRecord(entry)) return;
    const filter = firstDefined(
      entry.characterFilter,
      entry.character_filter,
      entry.extensions?.characterFilter,
      entry.extensions?.character_filter
    );
    if (!isRecord(filter)) return;
    const extensions = isRecord(entry.extensions) ? { ...entry.extensions } : {};
    const existingRegistry = normalizeRegistryInput(
      extensions.character_filter_tag_registry || []
    );
    const resolution = resolveWorldBookCharacterFilter(filter, {
      tagRegistry: [...existingRegistry, ...suppliedRegistry]
    });
    const appliedForEntry = resolution.mappings.filter((item) => suppliedIds.has(item.id));
    if (!appliedForEntry.length) return;

    const nextFilter = structuredClone(resolution.filter);
    const nextRegistry = normalizeRegistryInput([
      ...existingRegistry,
      ...resolution.mappings
    ]);
    const previous = JSON.stringify({
      characterFilter: entry.characterFilter,
      extensionFilter: extensions.character_filter,
      registry: extensions.character_filter_tag_registry
    });
    entry.characterFilter = nextFilter;
    extensions.character_filter = structuredClone(nextFilter);
    extensions.character_filter_tag_registry = nextRegistry;
    entry.extensions = extensions;
    const current = JSON.stringify({
      characterFilter: entry.characterFilter,
      extensionFilter: extensions.character_filter,
      registry: extensions.character_filter_tag_registry
    });
    if (current !== previous) changedEntryCount += 1;
    appliedForEntry.forEach((item) => applied.set(item.id, item.name));
  });

  const after = inspectWorldBookCharacterFilterTags(payload);
  return {
    payload,
    report: {
      suppliedMappingCount: suppliedRegistry.length,
      appliedMappings: [...applied.entries()].map(([id, name]) => ({ id, name })),
      changedEntryCount,
      unresolvedBefore: before.unresolved,
      unresolvedAfter: after.unresolved,
      resolvedMappingCount: after.resolvedMappings.length
    }
  };
}

export function looksLikeExternalTagId(value) {
  const text = stringValue(value);
  return UUID_TAG_ID.test(text) || COMPACT_HASH_TAG_ID.test(text);
}

function collectRegistryEntries(value, target) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isRecord(item)) return;
      const id = stringValue(item.id ?? item.tag_id ?? item.tagId);
      const name = stringValue(item.name ?? item.label ?? item.tag_name ?? item.tagName);
      if (id && name) target.set(id, name);
    });
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.tags)) collectRegistryEntries(value.tags, target);
  if (Array.isArray(value.entries)) collectRegistryEntries(value.entries, target);
  Object.entries(value).forEach(([id, item]) => {
    if (['tags', 'entries'].includes(id)) return;
    const name = isRecord(item)
      ? stringValue(item.name ?? item.label ?? item.tag_name ?? item.tagName)
      : stringValue(item);
    if (stringValue(id) && name) target.set(stringValue(id), name);
  });
}

function normalizeRegistryInput(value) {
  const byId = new Map();
  collectRegistryEntries(value, byId);
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

function readWorldBookEntries(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.entries)) return value.entries;
  if (isRecord(value?.entries)) return Object.values(value.entries);
  return [];
}

function dedupeUnresolved(values) {
  const seen = new Set();
  return values.filter((item) => {
    const key = `${item.title}\u0000${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeStringArray(value) {
  const values = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
  return values.map(stringValue).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(stringValue).filter(Boolean))];
}

function booleanValue(value) {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

function stringValue(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTagRecord(value) {
  return isRecord(value) && stringValue(value.id) && stringValue(value.name);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}
