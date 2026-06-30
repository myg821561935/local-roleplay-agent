function normalizeNow(now) {
  if (!now) return new Date().toISOString();
  if (now instanceof Date) return now.toISOString();
  return String(now);
}

function stringValue(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item))
    .filter(Boolean);
}

function autoFactId(index) {
  if (index === undefined || Number.isNaN(Number(index))) {
    return `fact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  return `fact-${index}`;
}

export function normalizeFactCards(value, { now } = {}) {
  const safeNow = normalizeNow(now);
  if (!Array.isArray(value)) return [];

  const cards = [];
  for (let index = 0; index < value.length; index += 1) {
    const card = normalizeFactCard(value[index], { index, now: safeNow });
    if (card) cards.push(card);
  }
  return cards;
}

export function normalizeFactCard(value, { index, now } = {}) {
  const safeNow = normalizeNow(now);
  const raw = isPlainObject(value) ? value : { content: stringValue(value) };
  const content = stringValue(raw.content);
  if (!content) return null;

  const hasProvidedId = Boolean(stringValue(raw.id || raw.factId));
  const title = stringValue(raw.title || content);
  const id = stringValue(raw.id || raw.factId) || autoFactId(index);
  const keywords = normalizeStringArray(raw.keywords);

  return {
    ...raw,
    id,
    __generatedId: !hasProvidedId,
    title,
    content,
    type: stringValue(raw.type) || 'uncategorized',
    keywords,
    source: stringValue(raw.source) || 'auto-extracted',
    createdAt: safeNow,
    updatedAt: safeNow,
    enabled: raw.enabled !== false,
    extensions: isPlainObject(raw.extensions) ? raw.extensions : {}
  };
}

export function createWorldBookEntryFromFact(fact, { now } = {}) {
  const normalized = normalizeFactCard(fact, { now: normalizeNow(now) });
  if (!normalized) return null;

  return {
    id: `worldbook-${normalized.id}`,
    type: 'dynamic-memory',
    title: normalized.title,
    keywords: normalized.keywords,
    content: normalized.content,
    priority: 80,
    depth: 6,
    enabled: normalized.enabled,
    source: 'fact-management',
    extensions: {
      ...normalized.extensions,
      sourceFactId: normalized.id,
      sourceFactType: normalized.type
    },
    updatedAt: normalized.updatedAt
  };
}

export function worldBookIdentity(entry) {
  if (!entry) return '\n';
  return `${stringValue(entry.title)}\n${stringValue(entry.content)}`;
}
