import crypto from 'node:crypto';

export const ACTION_PROTOCOL_SPEC = 'lra.action/v1';
export const MAX_ACTIONS_PER_ENVELOPE = 20;

const ACTION_TYPES = new Set([
  'state.set',
  'state.increment',
  'state.append',
  'state.remove',
  'actor.move',
  'actor.status',
  'actor.knowledge.add',
  'actor.relationship.adjust',
  'quest.update',
  'clock.advance'
]);
const VISIBILITIES = new Set(['public', 'private', 'director']);
const CONDITION_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'includes', 'exists']);
const BLOCK_PATTERNS = [
  /```lra-actions\s*([\s\S]*?)```/gi,
  /<lra-actions>\s*([\s\S]*?)<\/lra-actions>/gi
];

export class ActionProtocolError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'ActionProtocolError';
    this.code = code;
    this.detail = detail;
  }
}

export function normalizeActionEnvelope(input, { maxActions = MAX_ACTIONS_PER_ENVELOPE } = {}) {
  const source = Array.isArray(input) ? { actions: input } : input;
  if (!isPlainObject(source)) throw new ActionProtocolError('ACTION_ENVELOPE_INVALID');

  const spec = String(source.spec || source.schema || ACTION_PROTOCOL_SPEC).trim();
  if (spec !== ACTION_PROTOCOL_SPEC) {
    throw new ActionProtocolError('ACTION_SPEC_UNSUPPORTED', spec);
  }

  const sourceActions = Array.isArray(source.actions) ? source.actions : [];
  if (!sourceActions.length) throw new ActionProtocolError('ACTION_LIST_EMPTY');
  if (sourceActions.length > maxActions) {
    throw new ActionProtocolError('ACTION_LIST_TOO_LARGE', String(sourceActions.length));
  }

  const baseRevision = source.baseRevision === undefined || source.baseRevision === null
    ? null
    : normalizeNonNegativeInteger(source.baseRevision, 'ACTION_BASE_REVISION_INVALID');

  return {
    spec: ACTION_PROTOCOL_SPEC,
    id: normalizeId(source.id, 'envelope'),
    actorId: normalizeOptionalId(source.actorId || source.actor || 'narrator') || 'narrator',
    summary: normalizeText(source.summary || source.intent, 240),
    baseRevision,
    actions: sourceActions.map((action, index) => normalizeAction(action, index))
  };
}

export function extractActionEnvelope(text) {
  const source = String(text || '');
  let rawPayload = '';
  let matchedBlock = '';

  for (const pattern of BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      matchedBlock = match[0];
      rawPayload = match[1];
      break;
    }
  }

  if (!matchedBlock) {
    return { content: source, envelope: null, error: null, rawPayload: '' };
  }

  const content = stripActionBlocks(source).trimEnd();
  try {
    const parsed = JSON.parse(String(rawPayload || '').trim());
    return {
      content,
      envelope: normalizeActionEnvelope(parsed),
      error: null,
      rawPayload: String(rawPayload || '').trim()
    };
  } catch (error) {
    const protocolError = error instanceof ActionProtocolError
      ? error
      : new ActionProtocolError('ACTION_JSON_INVALID', error.message);
    return { content, envelope: null, error: protocolError, rawPayload: String(rawPayload || '').trim() };
  }
}

export function stripActionBlocks(text) {
  let result = String(text || '');
  for (const pattern of BLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '');
  }
  return result;
}

export function buildActionProtocolPrompt({ memory, targetSpeaker } = {}) {
  const revision = Number(memory?.simulation?.revision || 0);
  const speaker = String(targetSpeaker || '').trim();
  return [
    '# 世界动作协议',
    `当前状态修订号：${revision}。`,
    '叙事正文之后，如本回合确实造成可持续的世界变化，必须追加一个且仅一个 ```lra-actions JSON 块；没有稳定变化时不要输出该块。',
    '动作只是提议，最终由本地裁定器执行。不要在正文中解释协议，也不要把协议块当作对白。',
    '允许类型：state.set、state.increment、state.append、state.remove、actor.move、actor.status、actor.knowledge.add、actor.relationship.adjust、quest.update、clock.advance。',
    '每个动作应给出 reason；不确定的事实不要写入。私密情报使用 visibility=private，只有导演视图可见。',
    speaker ? `当前指定发言角色：${speaker}。该角色只能依据其已知信息行动。` : '',
    '格式示例：',
    '```lra-actions',
    JSON.stringify({
      spec: ACTION_PROTOCOL_SPEC,
      baseRevision: revision,
      actorId: speaker || 'narrator',
      summary: '本回合稳定变化',
      actions: [
        { type: 'state.append', path: 'protagonist.inventory', value: '旧铜钥匙', reason: '主角已拾取并保管' }
      ]
    }),
    '```'
  ].filter(Boolean).join('\n');
}

function normalizeAction(input, index) {
  if (!isPlainObject(input)) throw new ActionProtocolError('ACTION_INVALID', String(index));
  const type = String(input.type || '').trim();
  if (!ACTION_TYPES.has(type)) throw new ActionProtocolError('ACTION_TYPE_UNSUPPORTED', type || String(index));

  const base = {
    id: normalizeId(input.id, `action-${index + 1}`),
    type,
    visibility: normalizeVisibility(input.visibility),
    reason: normalizeText(input.reason, 300),
    conditions: normalizeConditions(input.conditions)
  };

  if (type.startsWith('state.')) {
    base.path = normalizePath(input.path);
    if (type === 'state.increment') {
      const delta = Number(input.delta ?? input.value);
      if (!Number.isFinite(delta) || Math.abs(delta) > 1_000_000) {
        throw new ActionProtocolError('ACTION_DELTA_INVALID', base.path);
      }
      base.delta = delta;
    } else {
      base.value = cloneSerializable(input.value);
    }
    return base;
  }

  if (type === 'actor.move') {
    return { ...base, actorId: requiredId(input.actorId || input.actor), location: requiredText(input.location, 'ACTION_LOCATION_REQUIRED', 160) };
  }
  if (type === 'actor.status') {
    return { ...base, actorId: requiredId(input.actorId || input.actor), status: requiredText(input.status, 'ACTION_STATUS_REQUIRED', 240) };
  }
  if (type === 'actor.knowledge.add') {
    return { ...base, actorId: requiredId(input.actorId || input.actor), fact: requiredText(input.fact || input.value, 'ACTION_FACT_REQUIRED', 500) };
  }
  if (type === 'actor.relationship.adjust') {
    const delta = Number(input.delta);
    if (!Number.isFinite(delta) || delta < -100 || delta > 100) {
      throw new ActionProtocolError('ACTION_RELATIONSHIP_DELTA_INVALID');
    }
    return {
      ...base,
      actorId: requiredId(input.actorId || input.actor),
      targetId: requiredId(input.targetId || input.target),
      delta
    };
  }
  if (type === 'quest.update') {
    const progress = input.progress === undefined ? null : Number(input.progress);
    if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
      throw new ActionProtocolError('ACTION_QUEST_PROGRESS_INVALID');
    }
    return {
      ...base,
      questId: requiredId(input.questId || input.quest),
      title: normalizeText(input.title, 160),
      status: normalizeQuestStatus(input.status),
      progress,
      note: normalizeText(input.note, 500)
    };
  }

  const minutes = Number(input.minutes ?? input.value);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10080) {
    throw new ActionProtocolError('ACTION_CLOCK_MINUTES_INVALID');
  }
  return { ...base, minutes };
}

function normalizeConditions(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 5) throw new ActionProtocolError('ACTION_CONDITIONS_INVALID');
  return input.map((condition) => {
    if (!isPlainObject(condition)) throw new ActionProtocolError('ACTION_CONDITION_INVALID');
    const operator = String(condition.operator || condition.op || 'eq').trim().toLowerCase();
    if (!CONDITION_OPERATORS.has(operator)) throw new ActionProtocolError('ACTION_CONDITION_OPERATOR_INVALID', operator);
    return {
      path: normalizePath(condition.path),
      operator,
      value: operator === 'exists' ? Boolean(condition.value ?? true) : cloneSerializable(condition.value)
    };
  });
}

function normalizePath(value) {
  const path = String(value || '').trim();
  const segments = path.split('.').filter(Boolean);
  if (!segments.length || segments.length > 8) throw new ActionProtocolError('ACTION_PATH_INVALID', path);
  if (segments.some((segment) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment) || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new ActionProtocolError('ACTION_PATH_INVALID', path);
  }
  return segments.join('.');
}

function normalizeQuestStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '';
  if (!['inactive', 'active', 'blocked', 'completed', 'failed'].includes(status)) {
    throw new ActionProtocolError('ACTION_QUEST_STATUS_INVALID', status);
  }
  return status;
}

function normalizeVisibility(value) {
  const visibility = String(value || 'public').trim().toLowerCase();
  return VISIBILITIES.has(visibility) ? visibility : 'public';
}

function normalizeId(value, prefix) {
  const normalized = normalizeOptionalId(value);
  return normalized || `${prefix}-${crypto.randomUUID()}`;
}

function requiredId(value) {
  const id = normalizeOptionalId(value);
  if (!id) throw new ActionProtocolError('ACTION_ACTOR_ID_REQUIRED');
  return id;
}

function normalizeOptionalId(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (!/^[A-Za-z0-9_.:\-\u4e00-\u9fff]{1,100}$/.test(id)) throw new ActionProtocolError('ACTION_ID_INVALID', id);
  return id;
}

function requiredText(value, code, limit) {
  const text = normalizeText(value, limit);
  if (!text) throw new ActionProtocolError(code);
  return text;
}

function normalizeText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeNonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ActionProtocolError(code);
  return number;
}

function cloneSerializable(value) {
  if (value === undefined) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ActionProtocolError('ACTION_VALUE_NOT_SERIALIZABLE');
  }
  if (serialized === undefined || serialized.length > 16000) {
    throw new ActionProtocolError('ACTION_VALUE_INVALID');
  }
  return JSON.parse(serialized);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
