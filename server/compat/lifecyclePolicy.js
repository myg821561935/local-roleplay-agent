export const DECLARATIVE_LIFECYCLE_EVENTS = Object.freeze([
  'onImport',
  'onUser',
  'onAssistant'
]);

export const DECLARATIVE_LIFECYCLE_BUDGETS = Object.freeze({
  maxExecutionsPerEvent: 8,
  allowedStatePathPrefixes: Object.freeze([
    'variables',
    'world',
    'character',
    'characters',
    'relationships',
    'quests',
    'inventory',
    'flags',
    'scene',
    'story',
    'status',
    'stats',
    'stat_data',
    'delta_data',
    'display_data'
  ]),
  allowedPatchOperations: Object.freeze(['set', 'increment', 'append', 'delete']),
  maxRecursionDepth: 4,
  maxChangesPerTurn: 32
});

const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function normalizeDeclarativeLifecycle(input = {}, diagnostics = []) {
  const source = isPlainObject(input) ? input : {};
  const eventSource = isPlainObject(source.events) ? source.events : source;
  const events = {};

  for (const event of DECLARATIVE_LIFECYCLE_EVENTS) {
    const candidate = eventSource[event];
    if (candidate === undefined || candidate === null) continue;
    const steps = normalizeLifecycleSteps(candidate, {
      event,
      diagnostics,
      depth: 0
    });
    if (steps.length) events[event] = steps;
  }

  return {
    schemaVersion: 1,
    mode: 'declarative-bounded',
    executesThirdPartyCode: false,
    budgets: structuredClone(DECLARATIVE_LIFECYCLE_BUDGETS),
    events
  };
}

export function normalizeLifecycleOperation(value) {
  if (typeof value === 'string') return parseAllowlistedSlashCommand(value);
  if (!isPlainObject(value)) return null;

  const operation = String(value.op || value.operation || value.type || '').trim().toLowerCase();
  if (!DECLARATIVE_LIFECYCLE_BUDGETS.allowedPatchOperations.includes(operation)) return null;
  const path = normalizeStatePath(value.path || value.key || value.variable);
  if (!path) return null;

  if (operation === 'increment') {
    const amount = Number(value.amount ?? value.value ?? 1);
    if (!Number.isFinite(amount)) return null;
    return { op: operation, path, value: amount };
  }
  if (operation === 'delete') return { op: operation, path };
  return { op: operation, path, value: cloneSerializable(value.value) };
}

export function parseAllowlistedSlashCommand(command = '') {
  const source = String(command || '').trim();
  const match = source.match(/^\/(setvar|incvar)\s+([\s\S]+)$/i);
  if (!match) return null;

  const name = match[1].toLowerCase();
  const args = parseCommandArguments(match[2]);
  const key = args.key || args.name || args.variable || args.positional.shift();
  const path = normalizeStatePath(`variables.${key || ''}`);
  if (!path) return null;

  if (name === 'incvar') {
    const rawAmount = args.value ?? args.amount ?? args.positional.shift() ?? 1;
    const amount = Number(rawAmount);
    return Number.isFinite(amount) ? { op: 'increment', path, value: amount } : null;
  }

  const rawValue = args.value ?? args.positional.join(' ');
  return {
    op: 'set',
    path,
    value: parseLiteral(rawValue)
  };
}

/**
 * 解析 SillyTavern 风格的双花括号变量写入宏：
 *   {{setvar::key::value}}  → 覆盖写入
 *   {{addvar::key::value}}  → 追加（数组/字符串/数值）
 *   {{incvar::key}}         → 数值 +1
 *   {{decvar::key}}         → 数值 -1
 * @param {string} text - 含宏的文本
 * @returns {Array<{op: string, path: string[], value: any}>} - 解析出的 MVU 操作
 */
export function parseMacroVariableWrites(text = '') {
  const source = String(text || '');
  const macroPattern = /\{\{\s*(setvar|addvar|incvar|decvar)\s*::\s*([^{}]+?)\s*\}\}/gi;
  const operations = [];
  let match;
  while ((match = macroPattern.exec(source)) && operations.length < 32) {
    const name = match[1].toLowerCase();
    const args = match[2].split('::').map((part) => part.trim()).filter(Boolean);
    const key = args[0];
    if (!key) continue;
    const path = normalizeStatePath(`variables.${key}`);
    if (!path) continue;

    if (name === 'setvar') {
      const value = args[1] ?? '';
      operations.push({ op: 'set', path, value: parseMacroValue(value) });
    } else if (name === 'addvar') {
      const value = args[1] ?? '';
      operations.push({ op: 'append', path, value: parseMacroValue(value) });
    } else if (name === 'incvar') {
      operations.push({ op: 'increment', path, value: 1 });
    } else if (name === 'decvar') {
      operations.push({ op: 'increment', path, value: -1 });
    }
  }
  return operations;
}

function parseMacroValue(value) {
  const raw = String(value || '').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (raw !== '' && Number.isFinite(num)) return num;
  // 去除引号包裹
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function isAllowedLifecyclePath(path, currentValues = {}) {
  const normalized = normalizeStatePath(path);
  if (!normalized) return false;
  const [root] = normalized.split('.');
  const existingRoots = isPlainObject(currentValues) ? Object.keys(currentValues) : [];
  return existingRoots.includes(root)
    || DECLARATIVE_LIFECYCLE_BUDGETS.allowedStatePathPrefixes.includes(root);
}

function normalizeLifecycleSteps(value, context) {
  if (context.depth > DECLARATIVE_LIFECYCLE_BUDGETS.maxRecursionDepth) {
    context.diagnostics.push({
      code: 'lifecycle-recursion-blocked',
      event: context.event,
      maxDepth: DECLARATIVE_LIFECYCLE_BUDGETS.maxRecursionDepth
    });
    return [];
  }

  const values = Array.isArray(value)
    ? value
    : isPlainObject(value) && Array.isArray(value.steps)
      ? value.steps
      : isPlainObject(value) && Array.isArray(value.operations)
        ? value.operations
        : [value];
  const steps = [];
  if (values.length > DECLARATIVE_LIFECYCLE_BUDGETS.maxChangesPerTurn) {
    context.diagnostics.push({
      code: 'lifecycle-change-budget-truncated',
      event: context.event,
      declared: values.length,
      maxChanges: DECLARATIVE_LIFECYCLE_BUDGETS.maxChangesPerTurn
    });
  }

  for (const candidate of values) {
    if (steps.length >= DECLARATIVE_LIFECYCLE_BUDGETS.maxChangesPerTurn) break;
    if (isPlainObject(candidate) && Array.isArray(candidate.steps)) {
      steps.push(...normalizeLifecycleSteps(candidate.steps, {
        ...context,
        depth: context.depth + 1
      }));
      continue;
    }
    const operation = normalizeLifecycleOperation(candidate);
    if (operation) {
      steps.push(operation);
      continue;
    }
    context.diagnostics.push({
      code: 'lifecycle-step-disabled',
      event: context.event,
      detail: summarizeCandidate(candidate)
    });
  }
  return steps.slice(0, DECLARATIVE_LIFECYCLE_BUDGETS.maxChangesPerTurn);
}

function parseCommandArguments(source) {
  const tokens = String(source || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const result = { positional: [] };
  for (const token of tokens) {
    const equals = token.indexOf('=');
    if (equals > 0) {
      result[token.slice(0, equals).toLowerCase()] = stripQuotes(token.slice(equals + 1));
    } else {
      result.positional.push(stripQuotes(token));
    }
  }
  return result;
}

function normalizeStatePath(value) {
  const parts = String(value || '')
    .trim()
    .replace(/^\$\.?/, '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 12) return '';
  if (parts.some((part) => BLOCKED_PATH_SEGMENTS.has(part) || !/^[\p{L}\p{N}_-]{1,80}$/u.test(part))) return '';
  return parts.join('.');
}

function parseLiteral(value) {
  const source = String(value ?? '').trim();
  if (!source) return '';
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}

function stripQuotes(value) {
  const source = String(value || '');
  if ((source.startsWith('"') && source.endsWith('"')) || (source.startsWith("'") && source.endsWith("'"))) {
    return source.slice(1, -1);
  }
  return source;
}

function summarizeCandidate(value) {
  if (typeof value === 'string') return value.slice(0, 120);
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return String(value).slice(0, 120);
  }
}

function cloneSerializable(value) {
  if (value === undefined) return null;
  return structuredClone(JSON.parse(JSON.stringify(value)));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
