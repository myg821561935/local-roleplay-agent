import { createDefaultMemory } from './memoryUpdater.js';

export function buildFactExtractionPrompt({ worldState, messages }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  return [
    {
      role: 'system',
      content: [
        '你是长篇角色扮演的事实提取器。',
        '只提取对后续创作稳定有用的新事实：人物状态、地点、关系、任务、阵营、物品、伤势、承诺、旗标。',
        '不要补充对话中没有确认的设定。',
        '只输出 JSON，不要输出解释。JSON 形如：{"worldState":{"protagonist":{},"location":{},"relationships":[],"quests":[],"factions":[],"flags":{},"timeline":[]},"memoryCards":[]}'
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
  const payload = parseJsonObject(content);
  if (payload.worldState && typeof payload.worldState === 'object') {
    next.worldState = mergeWorldState(next.worldState || createDefaultMemory().worldState, payload.worldState);
  }
  if (Array.isArray(payload.memoryCards)) {
    next.memoryCards = [...(Array.isArray(next.memoryCards) ? next.memoryCards : []), ...payload.memoryCards];
  }
  next.lastFactExtractionError = '';
  return next;
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
