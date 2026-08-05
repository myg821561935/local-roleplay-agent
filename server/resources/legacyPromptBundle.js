import crypto from 'node:crypto';

import { createFingerprint } from '../services/resourceLibrary/resourceConflictService.js';
import { createPromptBundlePayload, PROMPT_BUNDLE_KIND } from './promptBundle.js';

export const LEGACY_PROMPT_BUNDLE_MIGRATION_SCHEMA = 'local-roleplay-agent.legacy-prompt-bundle-migration/v1';

export function planLegacyPromptBundleMigrations(resources = []) {
  const ordered = Array.isArray(resources) ? resources.filter(Boolean) : [];
  const groups = new Map();

  ordered.forEach((resource, sourceIndex) => {
    const identity = getLegacyPresetIdentity(resource);
    if (!identity) return;
    const group = groups.get(identity.key) || {
      ...identity,
      firstSourceIndex: sourceIndex,
      resources: []
    };
    group.resources.push(resource);
    groups.set(identity.key, group);
  });

  const plans = [...groups.values()]
    .sort((left, right) => left.firstSourceIndex - right.firstSourceIndex)
    .map(createLegacyPromptBundlePlan);
  const planBySourceId = new Map();
  plans.forEach((plan) => {
    plan.sourceResourceIds.forEach((resourceId) => planBySourceId.set(resourceId, plan));
  });

  const emitted = new Set();
  const promptResourceIds = [];
  ordered.forEach((resource) => {
    const plan = planBySourceId.get(String(resource?.id || ''));
    if (!plan) {
      if (resource?.id) promptResourceIds.push(String(resource.id));
      return;
    }
    if (emitted.has(plan.resourceId)) return;
    emitted.add(plan.resourceId);
    promptResourceIds.push(plan.resourceId);
  });

  return { plans, promptResourceIds };
}

function createLegacyPromptBundlePlan(group) {
  const resources = [...group.resources].sort(compareLegacyPromptResources);
  const sourceResourceIds = resources.map((resource) => String(resource.id || '')).filter(Boolean);
  const preset = mergeLegacyPresetMetadata(resources, group.title, group.sourceFormat);
  const promptModules = resources.map((resource) => resource.payload || {});
  const payload = createPromptBundlePayload({
    title: group.title,
    sourceKind: group.sourceKind,
    preset,
    promptModules
  });
  const fingerprint = createFingerprint(payload);
  const resourceId = `legacy-prompt-bundle-${fingerprint.slice(0, 24)}`;
  const revisionId = `legacy-prompt-bundle-rev-${fingerprint.slice(0, 24)}`;
  const runtimeCompanionCount = payload.promptModules.filter(isRuntimeCompanion).length;
  const contentModules = payload.promptModules.filter((module) => !isRuntimeCompanion(module));
  const source = resources[0]?.source || {};
  const createdAt = earliestTimestamp(resources) || String(source.importedAt || '');
  const updatedAt = latestTimestamp(resources) || createdAt;

  return {
    schema: LEGACY_PROMPT_BUNDLE_MIGRATION_SCHEMA,
    resourceId,
    revisionId,
    sourceResourceIds,
    sourceResourceCount: sourceResourceIds.length,
    title: group.title,
    sourceKind: group.sourceKind,
    sourceFormat: group.sourceFormat,
    moduleCount: contentModules.length,
    enabledModuleCount: contentModules.filter((module) => module.enabled !== false).length,
    runtimeCompanionCount,
    regexRuleCount: payload.promptModules.reduce((sum, module) => (
      sum + Number(module?.extensions?.sillyTavernRuntimeCompanion?.ruleCount || 0)
    ), 0),
    fingerprint,
    createdAt,
    updatedAt,
    source: {
      ...source,
      adapterId: String(source.adapterId || group.sourceFormat || '').trim(),
      fileName: String(source.fileName || '').trim(),
      importBatchId: String(source.importBatchId || '').trim(),
      importedAt: String(source.importedAt || createdAt || '').trim()
    },
    candidate: {
      kind: PROMPT_BUNDLE_KIND,
      title: group.title,
      summary: [
        `${contentModules.length} 个内部模块`,
        `${contentModules.filter((module) => module.enabled !== false).length} 个已启用`,
        runtimeCompanionCount ? `${runtimeCompanionCount} 个运行伴侣` : '',
        group.sourceFormat ? '由历史分片无损折叠' : ''
      ].filter(Boolean).join(' · '),
      tags: uniqueStrings([
        ...resources.flatMap((resource) => resource.tags || []),
        'SillyTavern',
        '历史预设已折叠'
      ]),
      collections: uniqueStrings([
        group.title,
        ...resources.flatMap((resource) => resource.collections || [])
      ]),
      payload,
      version: String(source.version || '')
    }
  };
}

function getLegacyPresetIdentity(resource) {
  if (resource?.kind !== 'prompt') return null;
  const preset = resource.payload?.extensions?.sillyTavernPreset;
  const runtimeCompanion = resource.payload?.extensions?.sillyTavernRuntimeCompanion;
  const presetTitle = String(preset?.presetTitle || '').trim();
  const sourceFormat = String(preset?.sourceFormat || resource.format || '').trim();
  if (!presetTitle && !runtimeCompanion) return null;
  if (!/sillytavern|regex/i.test(sourceFormat) && !runtimeCompanion) return null;
  const source = resource.source || {};
  const fileName = String(source.fileName || '').trim();
  const importBatchId = String(source.importBatchId || '').trim();
  const title = presetTitle || stripFileExtension(fileName) || resource.title || '历史预设';
  const sourceKind = /regex/i.test(sourceFormat) ? 'regex-preset' : 'prompt-preset';
  const key = [
    importBatchId ? `batch:${importBatchId}` : '',
    fileName ? `file:${fileName}` : '',
    `title:${title}`,
    `format:${sourceFormat}`
  ].filter(Boolean).join('|');
  return { key, title, sourceFormat, sourceKind };
}

function mergeLegacyPresetMetadata(resources, title, sourceFormat) {
  const metadata = resources
    .map((resource) => resource.payload?.extensions?.sillyTavernPreset)
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const pickObject = (key) => metadata.find((value) => isNonEmptyObject(value[key]))?.[key] || {};
  const pickArray = (key) => metadata.find((value) => Array.isArray(value[key]) && value[key].length)?.[key] || [];
  return {
    title,
    sourceFormat,
    generationSettings: structuredClone(pickObject('generationSettings')),
    promptLayout: structuredClone(pickArray('promptLayout')),
    dependencySignals: structuredClone(pickObject('dependencySignals')),
    regexCompatibility: structuredClone(pickObject('regexCompatibility'))
  };
}

function compareLegacyPromptResources(left, right) {
  const leftPreset = left?.payload?.extensions?.sillyTavernPreset || {};
  const rightPreset = right?.payload?.extensions?.sillyTavernPreset || {};
  return compareOptionalNumber(leftPreset.sequence, rightPreset.sequence)
    || compareOptionalNumber(leftPreset.originalIndex, rightPreset.originalIndex)
    || String(left?.id || '').localeCompare(String(right?.id || ''));
}

function compareOptionalNumber(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftValid = Number.isFinite(leftNumber);
  const rightValid = Number.isFinite(rightNumber);
  if (leftValid && rightValid) return leftNumber - rightNumber;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}

function isRuntimeCompanion(module) {
  return Boolean(module?.extensions?.sillyTavernRuntimeCompanion);
}

function earliestTimestamp(resources) {
  return timestampValues(resources).sort()[0] || '';
}

function latestTimestamp(resources) {
  return timestampValues(resources).sort().at(-1) || '';
}

function timestampValues(resources) {
  return resources.flatMap((resource) => [
    resource?.createdAt,
    resource?.updatedAt,
    resource?.source?.importedAt
  ]).filter(Boolean).map(String);
}

function stripFileExtension(value) {
  return String(value || '').replace(/\.[^.]+$/u, '').trim();
}

function isNonEmptyObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}
