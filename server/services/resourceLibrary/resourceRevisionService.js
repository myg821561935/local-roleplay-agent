import crypto from 'node:crypto';

const REVISION_SCHEMA = 'local-roleplay-agent.resource-revision/v1';
const REVIEW_REQUIREMENT_IDS = new Set([
  'executable-extension',
  'regex-scripts',
  'stscript',
  'tavern-helper'
]);
const MAX_DIFF_CHANGES = 80;

export class ResourceRevisionService {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
  }

  withRevisionSummary(resource = {}) {
    if (resource.revision?.headId) return structuredClone(resource);
    return {
      ...structuredClone(resource),
      revision: {
        schema: REVISION_SCHEMA,
        headId: '',
        number: 1,
        count: 1,
        changeType: 'legacy-import',
        changedAt: String(resource.updatedAt || resource.createdAt || ''),
        sourceVersion: String(resource.source?.version || ''),
        securityReview: securityReviewFor(resource)
      }
    };
  }

  findUpdateTarget(candidate = {}, existingResources = [], source = {}) {
    const matchingKind = existingResources.filter((item) => item.kind === candidate.kind);
    const url = normalizeSourceUrl(source.url);
    if (url) {
      const byUrl = matchingKind.filter((item) => normalizeSourceUrl(item.source?.url) === url);
      if (byUrl.length) return newestResource(byUrl);
    }

    const fileName = normalizeSourcePart(source.fileName);
    if (fileName) {
      const site = normalizeSourcePart(source.site || source.sourceId || 'local-file');
      const byFile = matchingKind.filter((item) => (
        normalizeSourcePart(item.source?.fileName) === fileName
        && normalizeSourcePart(item.source?.site || 'local-file') === site
      ));
      if (byFile.length) return newestResource(byFile);
    }
    return null;
  }

  describeUpdate(current, incoming) {
    if (!current || !incoming) return null;
    const diff = summarizeResourceDiff(current, incoming);
    return {
      available: diff.changed,
      targetResourceId: current.id,
      currentRevisionId: String(current.revision?.headId || ''),
      currentRevisionNumber: Number(current.revision?.number || 1),
      nextRevisionNumber: Number(current.revision?.number || 1) + 1,
      sourceMatch: sourceMatchLabel(current.source, incoming.source),
      securityReviewRequired: securityReviewFor(incoming).required,
      diff
    };
  }

  initialize(resource, { changeType = 'import' } = {}) {
    const changedAt = String(resource.updatedAt || resource.createdAt || this.now().toISOString());
    const revisionId = String(resource.revision?.headId || crypto.randomUUID());
    const number = Math.max(1, Number(resource.revision?.number || 1));
    const count = Math.max(number, Number(resource.revision?.count || number));
    const next = {
      ...structuredClone(resource),
      revision: revisionState(resource, {
        revisionId,
        number,
        count,
        changeType,
        changedAt
      })
    };
    return {
      resource: next,
      revision: createRevisionRecord(next, {
        revisionId,
        number,
        changeType,
        changedAt,
        diff: initialDiff(next)
      })
    };
  }

  advance(current, incoming, {
    changeType = 'upstream-update',
    diff = summarizeResourceDiff(current, incoming),
    restoredFromRevisionId = ''
  } = {}) {
    const changedAt = this.now().toISOString();
    const revisionId = crypto.randomUUID();
    const number = Math.max(1, Number(current.revision?.number || 1)) + 1;
    const count = Math.max(number, Number(current.revision?.count || 1) + 1);
    const next = {
      ...structuredClone(incoming),
      id: current.id,
      createdAt: current.createdAt || incoming.createdAt || changedAt,
      updatedAt: changedAt,
      revision: revisionState(incoming, {
        revisionId,
        number,
        count,
        changeType,
        changedAt,
        restoredFromRevisionId
      })
    };
    return {
      resource: next,
      revision: createRevisionRecord(next, {
        revisionId,
        number,
        changeType,
        changedAt,
        restoredFromRevisionId,
        diff
      })
    };
  }

  restore(current, targetRevision) {
    const snapshot = targetRevision?.snapshot;
    if (!snapshot || targetRevision.resourceId !== current.id) {
      throw new Error('RESOURCE_REVISION_INVALID');
    }
    const incoming = {
      ...structuredClone(snapshot),
      id: current.id,
      title: current.title,
      summary: current.summary,
      tags: structuredClone(current.tags || []),
      collections: structuredClone(current.collections || []),
      favorite: current.favorite === true,
      createdAt: current.createdAt
    };
    return this.advance(current, incoming, {
      changeType: 'rollback',
      diff: summarizeResourceDiff(current, incoming),
      restoredFromRevisionId: targetRevision.id
    });
  }
}

export function summarizeResourceDiff(current = {}, incoming = {}) {
  const changes = [];
  compareValue(current.title, incoming.title, 'title', changes);
  compareValue(current.source?.version || '', incoming.source?.version || '', 'source.version', changes);
  compareValue(current.payload || {}, incoming.payload || {}, 'payload', changes);
  const counts = changes.reduce((result, change) => {
    result[change.type] = (result[change.type] || 0) + 1;
    return result;
  }, { added: 0, modified: 0, removed: 0 });
  const tokenDelta = Number(incoming.diagnostics?.estimatedTokens || 0)
    - Number(current.diagnostics?.estimatedTokens || 0);
  return {
    changed: changes.length > 0,
    summary: changes.length
      ? `新增 ${counts.added} 项，修改 ${counts.modified} 项，移除 ${counts.removed} 项`
      : '内容没有变化',
    counts,
    tokenDelta,
    changes: changes.slice(0, MAX_DIFF_CHANGES),
    truncated: changes.length > MAX_DIFF_CHANGES
  };
}

function compareValue(before, after, path, changes) {
  if (deepEqual(before, after) || changes.length > MAX_DIFF_CHANGES * 2) return;
  if (isKeyedCollectionPath(path) && Array.isArray(before) && Array.isArray(after)) {
    compareKeyedCollection(before, after, path, changes);
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    keys.forEach((key) => compareValue(before[key], after[key], `${path}.${key}`, changes));
    return;
  }
  const type = before === undefined
    ? 'added'
    : after === undefined
      ? 'removed'
      : 'modified';
  changes.push({
    path,
    label: diffLabel(path),
    type,
    before: summarizeValue(before),
    after: summarizeValue(after)
  });
}

function compareKeyedCollection(before, after, path, changes) {
  const beforeMap = keyedItems(before);
  const afterMap = keyedItems(after);
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  keys.forEach((key) => {
    const left = beforeMap.get(key);
    const right = afterMap.get(key);
    if (left === undefined) {
      changes.push({ path: `${path}.${key}`, label: itemLabel(right, key), type: 'added', before: '', after: summarizeValue(right) });
      return;
    }
    if (right === undefined) {
      changes.push({ path: `${path}.${key}`, label: itemLabel(left, key), type: 'removed', before: summarizeValue(left), after: '' });
      return;
    }
    if (!deepEqual(left, right)) {
      changes.push({ path: `${path}.${key}`, label: itemLabel(right, key), type: 'modified', before: summarizeValue(left), after: summarizeValue(right) });
    }
  });
}

function keyedItems(items) {
  return new Map(items.map((item, index) => [
    String(item?.id || item?.uid || item?.title || item?.name || index),
    item
  ]));
}

function isKeyedCollectionPath(path) {
  return path === 'payload.entries' || path === 'payload.promptModules';
}

function itemLabel(item, fallback) {
  return String(item?.title || item?.name || item?.id || fallback || '未命名条目');
}

function diffLabel(path) {
  const labels = {
    title: '素材标题',
    'source.version': '来源版本',
    'payload.name': '角色名称',
    'payload.description': '角色描述',
    'payload.personality': '性格与行为',
    'payload.scenario': '当前场景',
    'payload.firstMessage': '开场白',
    'payload.systemPrompt': '角色提示词',
    'payload.postHistoryInstructions': '历史后指令',
    'payload.entries': '世界书条目',
    'payload.promptModules': '预设模块'
  };
  return labels[path] || path.replace(/^payload\./, '');
}

function summarizeValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return clip(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') {
    const title = value.title || value.name || value.id;
    return title ? clip(String(title)) : `${Object.keys(value).length} 个字段`;
  }
  return String(value);
}

function clip(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

function initialDiff(resource) {
  return {
    changed: true,
    summary: '初始导入版本',
    counts: { added: 1, modified: 0, removed: 0 },
    tokenDelta: Number(resource.diagnostics?.estimatedTokens || 0),
    changes: [],
    truncated: false
  };
}

function revisionState(resource, {
  revisionId,
  number,
  count,
  changeType,
  changedAt,
  restoredFromRevisionId = ''
}) {
  return {
    schema: REVISION_SCHEMA,
    headId: revisionId,
    number,
    count,
    changeType,
    changedAt,
    sourceVersion: String(resource.source?.version || ''),
    restoredFromRevisionId,
    securityReview: securityReviewFor(resource)
  };
}

function createRevisionRecord(resource, {
  revisionId,
  number,
  changeType,
  changedAt,
  restoredFromRevisionId = '',
  diff
}) {
  const { revision: _revision, ...snapshot } = structuredClone(resource);
  return {
    schema: REVISION_SCHEMA,
    id: revisionId,
    resourceId: resource.id,
    number,
    createdAt: changedAt,
    changeType,
    restoredFromRevisionId,
    fingerprint: String(resource.fingerprint || ''),
    sourceVersion: String(resource.source?.version || ''),
    diff: structuredClone(diff || {}),
    securityReview: securityReviewFor(resource),
    snapshot
  };
}

function securityReviewFor(resource = {}) {
  const diagnostics = resource.diagnostics || {};
  const requirements = diagnostics.communityCompatibility?.requirements || [];
  const matched = requirements.filter((item) => (
    REVIEW_REQUIREMENT_IDS.has(String(item.id || ''))
    && item.status !== 'supported'
  ));
  const riskFlags = Array.isArray(diagnostics.riskFlags) ? diagnostics.riskFlags : [];
  const required = matched.length > 0 || riskFlags.length > 0;
  return {
    required,
    status: required ? 'pending' : 'not-required',
    contentHash: String(resource.fingerprint || ''),
    reasons: [
      ...matched.map((item) => String(item.label || item.id || '')).filter(Boolean),
      ...riskFlags.map((item) => String(item.message || item.code || '')).filter(Boolean)
    ].slice(0, 8)
  };
}

function sourceMatchLabel(current = {}, incoming = {}) {
  if (normalizeSourceUrl(current.url) && normalizeSourceUrl(current.url) === normalizeSourceUrl(incoming.url)) {
    return 'source-url';
  }
  if (normalizeSourcePart(current.fileName) && normalizeSourcePart(current.fileName) === normalizeSourcePart(incoming.fileName)) {
    return 'local-file';
  }
  return 'source';
}

function newestResource(resources) {
  return [...resources].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null;
}

function normalizeSourceUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    return url.toString();
  } catch {
    return text.toLowerCase();
  }
}

function normalizeSourcePart(value) {
  return String(value || '').trim().toLowerCase();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepEqual(left, right) {
  return JSON.stringify(stripDiffVolatile(left)) === JSON.stringify(stripDiffVolatile(right));
}

function stripDiffVolatile(value) {
  if (Array.isArray(value)) return value.map(stripDiffVolatile);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['raw', 'updatedAt', 'createdAt', 'importedAt'].includes(key))
    .map(([key, item]) => [key, stripDiffVolatile(item)]));
}
