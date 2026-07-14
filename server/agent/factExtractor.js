import { createDefaultMemory } from './memoryUpdater.js';
import { normalizeFactCards, worldBookIdentity } from './factCards.js';
import { buildNarrativeMaintenanceAnchor, normalizeNarrativeMode } from './narrativeControl.js';

export function buildFactExtractionPrompt({ worldState, messages, narrativeContext }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  const narrativeAnchor = buildNarrativeMaintenanceAnchor(narrativeContext);
  return [
    {
      role: 'system',
      content: [
        '你是长篇角色扮演的事实提取器。',
        '只提取对后续创作稳定有用的新事实：人物状态、地点、关系、任务、阵营、物品、伤势、承诺、旗标、资源权属、制度职位和未清债务。',
        '不要补充对话中没有确认的设定。',
        'memoryCards 用于给创作者审阅；worldBook 用于可被关键词触发的动态世界书条目。',
        '如果新事实需要长期按关键词注入，请同时写入 worldBook。worldBook 条目至少包含 title、keywords、content、depth；depth 表示插入深度，通常为 6。',
        narrativeAnchor ? `【叙事路线门禁】\n${narrativeAnchor}` : '',
        '探索、解密、生存等从属情节可以作为事实记录，但不得据此修改主类型、替换当前主线或创造新的世界底层规则。不要修改 worldState.flags.genre。',
        '每条 memoryCards 和 worldBook 都在 extensions 中标注：stability（candidate 或 confirmed）、genre、narrativeRole（core、supporting 或 drift）、returnsToPillar。',
        '只有用户明确选择/确认，或已经形成不可逆且可观察后果的事实，stability 才能写 confirmed；仅由模型在单轮中提出的新支线一律写 candidate。',
        'supporting 条目必须写明 returnsToPillar，说明它回流到哪一项主线、资源、关系或证据；偏航内容标为 drift，不得写入 worldBook。',
        '资源和制度事实尽量写入 worldState.resourceLedger、worldState.obligations、worldState.institutionLedger；必须注明来源、当前持有者/责任人、权属或职权、限制和未清后果。',
        '只输出 JSON，不要输出解释。JSON 形如：{"worldState":{"protagonist":{},"location":{},"relationships":[],"quests":[],"factions":[],"flags":{},"timeline":[],"resourceLedger":[],"obligations":[],"institutionLedger":[]},"memoryCards":[{"title":"","content":"","extensions":{"stability":"candidate","genre":"","narrativeRole":"supporting","returnsToPillar":""}}],"worldBook":[{"title":"","keywords":[],"content":"","depth":6,"extensions":{"stability":"confirmed","genre":"","narrativeRole":"core","returnsToPillar":""}}]}'
      ].join('\n')
    },
    {
      role: 'user',
      content: `当前 World State：\n${JSON.stringify(worldState || {}, null, 2)}\n\n新增对话：\n${transcript}\n\n请输出需要合并的新事实 JSON。`
    }
  ];
}

export function applyFactExtractionResult(memory, content, { narrativeContext } = {}) {
  const next = structuredClone(memory || createDefaultMemory());
  const payload = parseFactExtractionResult(content);
  if (payload.worldState && typeof payload.worldState === 'object') {
    const patch = sanitizeWorldStatePatch(payload.worldState, next.worldState, narrativeContext);
    next.worldState = mergeWorldState(next.worldState || createDefaultMemory().worldState, patch);
  }
  if (Array.isArray(payload.memoryCards)) {
    const safeNow = new Date().toISOString();
    const existingCards = normalizeFactCards(next.memoryCards, { now: safeNow });
    const incomingCards = normalizeFactCards(
      payload.memoryCards.map((card) => applyNarrativeAdmission(card, narrativeContext)),
      { now: safeNow }
    );
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

export function normalizeDynamicWorldBookEntries(content, { narrativeContext } = {}) {
  const payload = parseFactExtractionResult(content);
  const entries = Array.isArray(payload.worldBook) ? payload.worldBook : [];
  return entries
    .filter((entry) => entry && stringValue(entry.content))
    .filter((entry) => canAutoPromoteWorldBookEntry(entry, narrativeContext))
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
  const parsed = tryParseJson(candidate) || tryExtractFirstJsonObject(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function tryParseJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

function tryExtractFirstJsonObject(text) {
  const start = String(text || '').indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return tryParseJson(text.slice(start, index + 1));
      }
    }
  }
  return null;
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

function sanitizeWorldStatePatch(patch, current, narrativeContext) {
  if (!isPlainObject(patch)) return patch;
  const nextPatch = structuredClone(patch);
  if (!narrativeContext) return nextPatch;
  const mode = normalizeNarrativeMode(narrativeContext?.mode);
  if (mode === 'free') return nextPatch;

  if (isPlainObject(nextPatch.flags)) {
    const currentGenre = stringValue(current?.flags?.genre || narrativeContext?.genre);
    if (currentGenre) nextPatch.flags.genre = currentGenre;
  }
  return nextPatch;
}

function applyNarrativeAdmission(card, narrativeContext) {
  if (!isPlainObject(card)) return card;
  if (!narrativeContext) return card;
  const mode = normalizeNarrativeMode(narrativeContext?.mode);
  if (mode === 'free') return card;

  const extensions = isPlainObject(card.extensions) ? { ...card.extensions } : {};
  const stability = stringValue(extensions.stability).toLowerCase();
  const role = stringValue(extensions.narrativeRole).toLowerCase();
  const genre = stringValue(extensions.genre);
  const expectedGenre = stringValue(narrativeContext?.genre);
  const genreMatches = !expectedGenre || !genre || genre === expectedGenre;
  const supportingReturns = role !== 'supporting' || Boolean(stringValue(extensions.returnsToPillar));
  const admitted = stability === 'confirmed' && role !== 'drift' && genreMatches && supportingReturns;

  return {
    ...card,
    enabled: admitted && card.enabled !== false,
    extensions: {
      ...extensions,
      reviewStatus: admitted ? 'admitted' : 'candidate',
      admissionReason: admitted ? 'confirmed-within-route' : 'requires-creator-review'
    }
  };
}

function canAutoPromoteWorldBookEntry(entry, narrativeContext) {
  if (!narrativeContext) return true;
  const mode = normalizeNarrativeMode(narrativeContext?.mode);
  if (mode === 'free') return true;
  const extensions = isPlainObject(entry.extensions) ? entry.extensions : {};
  const stability = stringValue(extensions.stability).toLowerCase();
  const role = stringValue(extensions.narrativeRole).toLowerCase();
  const genre = stringValue(extensions.genre);
  const expectedGenre = stringValue(narrativeContext?.genre);
  if (stability !== 'confirmed' || role === 'drift') return false;
  if (expectedGenre && genre && genre !== expectedGenre) return false;
  if (role === 'supporting' && !stringValue(extensions.returnsToPillar)) return false;
  return true;
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
