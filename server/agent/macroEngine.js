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
 *   轻前端状态：{{getvar::relationships.shen}} {{globalvar::clues}}
 *   引用：{{get_worldbook:title:落雁夜市}}
 *   数组随机：{{pick:array_name}}
 *   模板：{{template:name}}
 */

import { renderSafeTemplate } from '../compat/lightFrontendRuntime.js';

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
  const safelyRendered = renderSafeTemplate(text, context, { unsupported: 'strip' });
  return safelyRendered.replace(MACRO_REGEX, (full, rawBody) => {
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
  if (lower === 'charifnotgroup') {
    const hasGroup = Array.isArray(context.groupMembers)
      && context.groupMembers.some((member) => member?.enabled !== false && String(member?.name || '').trim());
    return hasGroup ? '' : (context.characterCard?.name || '主角');
  }

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
  // SillyTavern 的空白裁剪标记不产生可见文本；在本项目中安全降级为空串。
  if (lower === 'trim') return '';
  if (lower === 'message_count') {
    return String((context.messages || []).filter((m) => !m.excluded).length);
  }
  if (lower === 'word_count') {
    const text = (context.messages || []).map((m) => m.content || '').join('');
    return String(text.length);
  }
  if (lower === 'last_user_message' || lower === 'lastusermessage') {
    const userMsgs = (context.messages || []).filter((m) => m.role === 'user' && !m.excluded);
    const last = userMsgs[userMsgs.length - 1];
    return last?.content || '';
  }

  // —— Prompt 内声明式变量写入 ——
  // 只在调用方显式开启时使用临时作用域；不会执行 JavaScript，也不会持久化到会话。
  if (/^(setvar|addvar|incvar|decvar)::/i.test(body) && context.allowVariableWrites === true) {
    return applyPromptVariableWrite(body, context);
  }

  // —— 社区轻前端只读变量 ——
  if (lower.startsWith('getvar::') || lower.startsWith('globalvar::')) {
    const separator = body.indexOf('::');
    return resolveLightFrontendState(body.slice(separator + 2), context);
  }

  // 梦境思客等预设通过酒馆助手宏拼接 LoRA/变量片段。这里不执行助手脚本，
  // 仅从本轮声明式变量或轻前端状态读取同名值；未声明时安全降级为空串。
  if (lower.startsWith('压缩相邻消息::')) {
    return resolveLightFrontendState(body.slice(body.indexOf('::') + 2), context);
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

function resolveLightFrontendState(path, context) {
  const promptValue = readStatePath(context.promptVariables, path);
  if (promptValue.found) return serializeMacroValue(promptValue.value);
  const source = context.lightFrontendState ?? context.mvu ?? {};
  const values = isPlainObject(source?.values) ? source.values : isPlainObject(source) ? source : {};
  const result = readStatePath(values, path);
  return result.found ? serializeMacroValue(result.value) : '';
}

function applyPromptVariableWrite(body, context) {
  const parts = String(body || '').split('::');
  const operation = String(parts.shift() || '').trim().toLowerCase();
  const path = String(parts.shift() || '').trim();
  const pathParts = normalizeVariablePath(path);
  if (!pathParts.length) return '';
  const variables = isPlainObject(context.promptVariables) ? context.promptVariables : {};
  context.promptVariables = variables;
  const current = readStatePath(variables, path).value;
  const rawValue = parts.join('::').trim();
  let value;
  if (operation === 'setvar') value = parseMacroLiteral(rawValue);
  else if (operation === 'addvar') value = addMacroValues(current, parseMacroLiteral(rawValue));
  else if (operation === 'incvar') value = Number(current || 0) + 1;
  else value = Number(current || 0) - 1;
  writeStatePath(variables, pathParts, value);
  if (Array.isArray(context.promptVariableAudit) && context.promptVariableAudit.length < 256) {
    context.promptVariableAudit.push({ operation, path: pathParts.join('.') });
  }
  return '';
}

function readStatePath(source, path) {
  const parts = normalizeVariablePath(path);
  if (!parts.length || (!isPlainObject(source) && !Array.isArray(source))) return { found: false, value: undefined };
  let current = source;
  for (const part of parts) {
    if ((!isPlainObject(current) && !Array.isArray(current)) || !Object.hasOwn(current, part)) {
      return { found: false, value: undefined };
    }
    current = current[part];
  }
  return { found: true, value: current };
}

function writeStatePath(target, parts, value) {
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    if (!isPlainObject(current[part])) current[part] = {};
    current = current[part];
  });
}

function normalizeVariablePath(path) {
  const parts = String(path || '').replace(/^\//, '').split(/[./]/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return [];
  if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part) || !/^[\p{L}\p{N}_-]{1,80}$/u.test(part))) return [];
  return parts;
}

function parseMacroLiteral(value) {
  const raw = String(value ?? '').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const number = Number(raw);
  if (raw && Number.isFinite(number)) return number;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function addMacroValues(current, incoming) {
  if (typeof current === 'number' && typeof incoming === 'number') return current + incoming;
  if (Array.isArray(current)) return [...current, incoming];
  if (current === undefined || current === null || current === '') return incoming;
  return `${serializeMacroValue(current)}${serializeMacroValue(incoming)}`;
}

function serializeMacroValue(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
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
