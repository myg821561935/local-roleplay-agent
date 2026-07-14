/**
 * 进阶宏/Macro 引擎
 *
 * 支持的宏：
 *   身份：{{user}} {{char}} {{persona_name}} {{persona_description}} ...
 *   角色属性：{{char_name}} {{char_role}} {{char_description}} {{char_personality}} {{char_scenario}}
 *   随机：{{random:a,b,c}}  {{random:1-100}}
 *   骰子：{{roll:d6}}  {{roll:3d20+5}}  {{roll:d%}}
 *   时间：{{time}} {{date}} {{datetime}} {{timestamp}}
 *   状态：{{message_count}} {{word_count}} {{last_user_message}}
 *   引用：{{get_worldbook:title:落雁夜市}}
 *   数组随机：{{pick:array_name}}
 *   模板：{{template:name}}
 */

const MACRO_REGEX = /\{\{([^{}]+)\}\}/g;

/**
 * 展开 text 中的所有宏
 * @param {string} text
 * @param {Object} context - { user, characterCard, persona, groupMembers, messages, userMessage, worldBook, templates, customArrays }
 * @returns {string}
 */
export function expandMacros(text, context = {}) {
  if (typeof text !== 'string' || !text) return text;
  // 防止模板递归死循环
  const depth = Number(context._depth || 0);
  if (depth > 5) return text;
  return text.replace(MACRO_REGEX, (full, rawBody) => {
    const body = String(rawBody || '').trim();
    if (!body) return full;
    try {
      const value = resolveMacro(body, context);
      return value === null || value === undefined ? full : String(value);
    } catch {
      return full;
    }
  });
}

function resolveMacro(body, context) {
  const lower = body.toLowerCase();

  // —— 身份变量 ——
  if (lower === 'user') return context.user || '用户';
  if (lower === 'char') return context.characterCard?.name || '主角';

  if (lower.startsWith('persona_')) {
    const field = body.slice('persona_'.length).toLowerCase();
    const map = {
      name: 'name',
      description: 'description',
      background: 'background',
      personality: 'personality'
    };
    return context.persona?.[map[field]] || '';
  }

  // —— 角色属性 ——
  if (lower.startsWith('char_')) {
    const field = body.slice('char_'.length).toLowerCase();
    const map = {
      name: 'name',
      role: 'role',
      description: 'description',
      personality: 'personality',
      scenario: 'scenario'
    };
    return context.characterCard?.[map[field]] || '';
  }

  // —— 随机 ——
  if (lower.startsWith('random:')) {
    return resolveRandom(body.slice('random:'.length));
  }

  // —— 骰子 ——
  if (lower.startsWith('roll:')) {
    return resolveRoll(body.slice('roll:'.length));
  }

  // —— 时间 ——
  if (lower === 'time') return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (lower === 'date') return new Date().toLocaleDateString('zh-CN');
  if (lower === 'datetime') return new Date().toLocaleString('zh-CN', { hour12: false });
  if (lower === 'timestamp') return String(Math.floor(Date.now() / 1000));

  // —— 状态 ——
  if (lower === 'message_count') {
    return String((context.messages || []).filter((m) => !m.excluded).length);
  }
  if (lower === 'word_count') {
    const text = (context.messages || []).map((m) => m.content || '').join('');
    return String(text.length);
  }
  if (lower === 'last_user_message') {
    const userMsgs = (context.messages || []).filter((m) => m.role === 'user' && !m.excluded);
    const last = userMsgs[userMsgs.length - 1];
    return last?.content || '';
  }

  // —— 引用世界书 ——
  if (lower.startsWith('get_worldbook:')) {
    return resolveGetWorldbook(body.slice('get_worldbook:'.length), context);
  }

  // —— 自定义数组随机 ——
  if (lower.startsWith('pick:')) {
    return resolvePick(body.slice('pick:'.length), context);
  }

  // —— 模板 ——
  if (lower.startsWith('template:')) {
    return resolveTemplate(body.slice('template:'.length), context);
  }

  return null;
}

function resolveRandom(arg) {
  const trimmed = String(arg || '').trim();
  if (!trimmed) return '';
  // 数字范围：1-100 / 1-6
  const rangeMatch = trimmed.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (max < min) return '';
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  }
  // 逗号分隔
  const items = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return '';
  return items[Math.floor(Math.random() * items.length)];
}

function resolveRoll(arg) {
  const trimmed = String(arg || '').trim().toLowerCase();
  if (!trimmed) return null;
  // d% = d100
  const normalized = trimmed === 'd%' ? 'd100' : trimmed;
  // 匹配 NdM+K 或 NdM-K 或 dM
  const match = normalized.match(/^(\d*)d(\d+)(?:([+-])(\d+))?$/);
  if (!match) return null;
  const count = match[1] ? Math.max(1, Math.min(100, Number(match[1]))) : 1;
  const sides = Math.max(1, Math.min(1000, Number(match[2])));
  const op = match[3];
  const modifier = match[4] ? Number(match[4]) : 0;

  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * sides) + 1;
    rolls.push(r);
    total += r;
  }
  if (op === '+') total += modifier;
  else if (op === '-') total -= modifier;

  if (count === 1 && !op) return String(total);
  return `${total} (${rolls.join('+')}${op ? ` ${op} ${modifier}` : ''})`;
}

function resolveGetWorldbook(arg, context) {
  // 格式：title:落雁夜市  或  id:abc123
  const parts = String(arg || '').split(':');
  if (parts.length < 2) return '';
  const field = parts[0].trim().toLowerCase();
  const value = parts.slice(1).join(':').trim();
  const cards = Array.isArray(context.worldBook) ? context.worldBook : [];
  const found = cards.find((c) => String(c[field] || '').trim() === value);
  return found?.content || '';
}

function resolvePick(arg, context) {
  const name = String(arg || '').trim();
  if (!name) return '';
  const arrays = isPlainObject(context.customArrays) ? context.customArrays : {};
  const arr = Array.isArray(arrays[name]) ? arrays[name] : [];
  if (!arr.length) return '';
  return String(arr[Math.floor(Math.random() * arr.length)] || '');
}

function resolveTemplate(arg, context) {
  const name = String(arg || '').trim();
  if (!name) return '';
  const templates = Array.isArray(context.templates) ? context.templates : [];
  const tpl = templates.find((t) => t.name === name);
  if (!tpl) return '';
  // 模板内可能仍含宏，递归展开（限制深度防死循环）
  return expandMacros(tpl.content || '', { ...context, _depth: (context._depth || 0) + 1 });
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
