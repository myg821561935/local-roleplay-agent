const FACT_TYPES = new Set([
  'character',
  'location',
  'item',
  'quest',
  'relationship',
  'event',
  'flag',
  'uncategorized'
]);

function normalizeNow(now = new Date().toISOString()) {
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

function normalizeType(type) {
  const value = stringValue(type) || 'uncategorized';
  return FACT_TYPES.has(value) ? value : 'uncategorized';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item))
    .filter(Boolean);
}

export function normalizeFactCards(value, { now } = {}) {
  if (!Array.isArray(value)) return [];
  const safeNow = normalizeNow(now);
  const cards = [];
  for (let index = 0; index < value.length; index += 1) {
    const card = normalizeFactCard(value[index], { index, now: safeNow });
    if (card) cards.push(card);
  }
  return cards;
}

export function normalizeFactCard(value, { index, now } = {}) {
  const safeNow = normalizeNow(now);
  const raw = typeof value === 'string' ? { content: value } : value;
  if (!isPlainObject(raw)) return null;

  const content = stringValue(raw.content);
  if (!content) return null;

  const title = stringValue(raw.title) || content.slice(0, 40);
  const id = stringValue(raw.id) || autoFactId(content, index);
  const keywords = normalizeStringArray(raw.keywords);

  return {
    id,
    title,
    content,
    type: normalizeType(raw.type),
    keywords,
    source: stringValue(raw.source) || 'auto-extracted',
    createdAt: stringValue(raw.createdAt) || safeNow,
    updatedAt: stringValue(raw.updatedAt) || safeNow,
    enabled: raw.enabled !== false,
    extensions: isPlainObject(raw.extensions) ? raw.extensions : {}
  };
}

export function createWorldBookEntryFromFact(fact, { now } = {}) {
  const safeNow = normalizeNow(now);
  const normalized = normalizeFactCard(fact, { now: safeNow });
  if (!normalized) return null;

  return {
    id: `worldbook-${normalized.id}`,
    type: 'dynamic-memory',
    title: normalized.title,
    keywords: normalized.keywords,
    secondaryKeywords: [],
    matchMode: 'keyword',
    regex: [],
    logic: 'any',
    content: normalized.content,
    priority: 80,
    depth: 6,
    insertionOrder: 0,
    constant: false,
    caseSensitive: false,
    position: 'after_character',
    scope: 'prompt',
    enabled: true,
    source: 'fact-management',
    extensions: {
      ...normalized.extensions,
      sourceFactId: normalized.id,
      sourceFactType: normalized.type
    },
    updatedAt: safeNow
  };
}

export function worldBookIdentity(entry) {
  if (!entry) return '\n';
  return `${stringValue(entry.title)}\n${stringValue(entry.content)}`;
}

function autoFactId(content, index) {
  const compact = Buffer.from(`${index}:${content}`).toString('base64url').slice(0, 18);
  return `fact-${compact}`;
}
