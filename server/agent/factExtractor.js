import { createDefaultMemory } from './memoryUpdater.js';
import { normalizeFactCards, worldBookIdentity } from './factCards.js';

export function buildFactExtractionPrompt({ worldState, messages }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  return [
    {
      role: 'system',
      content: [
        '你是长篇角色扮演的事实提取器。',
        '只提取对后续创作稳定有用的新事实：人物状态、地点、关系、任务、阵营、物品、伤势、承诺、旗标。',
        '不要补充对话中没有确认的设定。',
        'memoryCards 用于给创作者审阅；worldBook 用于可被关键词触发的动态世界书条目。',
        '如果新事实需要长期按关键词注入，请同时写入 worldBook。worldBook 条目至少包含 title、keywords、content、depth；depth 表示插入深度，通常为 6。',
        '只输出 JSON，不要输出解释。JSON 形如：{"worldState":{"protagonist":{},"location":{},"relationships":[],"quests":[],"factions":[],"flags":{},"timeline":[]},"memoryCards":[],"worldBook":[{"title":"","keywords":[],"content":"","depth":6}]}'
      ].join('\n')
    },
    {
      role: 'user',
      content: `当前 World State：\n${JSON.stringify(worldState || {}, null, 2)}\n\n新增对话：\n${transcript}\n\n请输出需要合并的新事实 JSON。`
    }
  ];
}

export function applyFactExtractionResult(memory, content) {
  const next = structuredClone(memory || createDefaultMemory());
  const payload = parseFactExtractionResult(content);
  if (payload.worldState && typeof payload.worldState === 'object') {
    next.worldState = mergeWorldState(next.worldState || createDefaultMemory().worldState, payload.worldState);
  }
  if (Array.isArray(payload.memoryCards)) {
    const safeNow = new Date().toISOString();
    const existingCards = normalizeFactCards(next.memoryCards, { now: safeNow });
    const incomingCards = normalizeFactCards(payload.memoryCards, { now: safeNow });
    const seen = new Set();
    next.memoryCards = [...existingCards, ...incomingCards]
      .filter((card) => card && typeof card === 'object')
      .filter((card) => {
        const key = worldBookIdentity(card);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  next.lastFactExtractionError = '';
  return next;
}

export function parseFactExtractionResult(content) {
  return parseJsonObject(content);
}

export function normalizeDynamicWorldBookEntries(content) {
  const payload = parseFactExtractionResult(content);
  const entries = Array.isArray(payload.worldBook) ? payload.worldBook : [];
  return entries
    .filter((entry) => entry && stringValue(entry.content))
    .map((entry) => ({
      id: stringValue(entry.id) || `dynamic-memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: stringValue(entry.type) || 'dynamic-memory',
      title: stringValue(entry.title) || '动态记忆',
      keywords: normalizeStringArray(entry.keywords),
      secondaryKeywords: normalizeStringArray(entry.secondaryKeywords),
      matchMode: stringValue(entry.matchMode) || 'keyword',
      regex: normalizeStringArray(entry.regex),
      logic: stringValue(entry.logic) || 'any',
      content: stringValue(entry.content),
      priority: normalizeNumber(entry.priority, 75),
      depth: normalizeNumber(entry.depth, 6),
      insertionOrder: normalizeNumber(entry.insertionOrder, 0),
      constant: entry.constant === true,
      caseSensitive: entry.caseSensitive === true,
      position: stringValue(entry.position) || 'after_character',
      scope: stringValue(entry.scope) || 'prompt',
      enabled: entry.enabled !== false,
      source: 'dynamic-memory',
      extensions: isPlainObject(entry.extensions) ? entry.extensions : {},
      updatedAt: new Date().toISOString()
    }));
}

function parseJsonObject(content) {
  const text = String(content || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  const parsed = JSON.parse(candidate || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function mergeWorldState(current, patch) {
  if (Array.isArray(current) || Array.isArray(patch)) return mergeArrays(current, patch);
  if (!isPlainObject(current) || !isPlainObject(patch)) return patch ?? current;

  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      next[key] = mergeArrays(next[key], value);
    } else if (isPlainObject(value)) {
      next[key] = mergeWorldState(isPlainObject(next[key]) ? next[key] : {}, value);
    } else if (value !== undefined && value !== null && value !== '') {
      next[key] = value;
    }
  }
  return next;
}

function mergeArrays(current, patch) {
  const existing = Array.isArray(current) ? current : [];
  const incoming = Array.isArray(patch) ? patch : [];
  const seen = new Set(existing.map(stableKey));
  const merged = [...existing];
  incoming.forEach((item) => {
    const key = stableKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  });
  return merged;
}

function stableKey(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value) {
  return String(value ?? '').trim();
}
