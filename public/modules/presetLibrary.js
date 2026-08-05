export function groupPromptResources(resources = []) {
  const groups = new Map();

  for (const resource of Array.isArray(resources) ? resources : []) {
    if (!isPromptResource(resource)) continue;
    if (resource.kind === 'prompt-bundle') {
      const modules = Array.isArray(resource.payload?.promptModules) ? resource.payload.promptModules : [];
      const runtimeModules = modules.filter((module) => module?.extensions?.sillyTavernRuntimeCompanion);
      const contentModules = modules.filter((module) => !module?.extensions?.sillyTavernRuntimeCompanion);
      const group = {
        key: `bundle:${resource.id}`,
        title: resource.payload?.title || resource.title || '未命名预设',
        resourceIds: [resource.id],
        resources: [resource],
        moduleCount: contentModules.length,
        runtimeCount: runtimeModules.length,
        regexRuleCount: runtimeModules.reduce((sum, module) => (
          sum + Number(module.extensions?.sillyTavernRuntimeCompanion?.ruleCount || 0)
        ), 0),
        enabledCount: contentModules.filter((module) => module?.enabled !== false).length,
        estimatedTokens: estimateActivePromptTokens(
          contentModules,
          Number(resource.diagnostics?.estimatedTokens || 0)
        ),
        score: Number(resource.diagnostics?.score || 0),
        scoreTotal: Number(resource.diagnostics?.score || 0),
        scoreCount: Number(resource.diagnostics?.score || 0) > 0 ? 1 : 0,
        sourceLabel: resource.source?.site || '本地',
        sourceFormat: resource.payload?.sourceFormat || resource.format || '',
        isPresetBundle: true
      };
      groups.set(group.key, group);
      continue;
    }
    const preset = resource.payload?.extensions?.sillyTavernPreset || {};
    const runtimeCompanion = resource.payload?.extensions?.sillyTavernRuntimeCompanion || null;
    const presetTitle = String(preset.presetTitle || '').trim();
    const importBatchId = String(resource.source?.importBatchId || '').trim();
    const key = presetTitle
      ? `preset:${importBatchId || normalizeGroupKey(presetTitle)}`
      : `prompt:${resource.id}`;
    const group = groups.get(key) || {
      key,
      title: presetTitle || resource.title || resource.payload?.title || '未命名预设',
      resourceIds: [],
      resources: [],
      moduleCount: 0,
      runtimeCount: 0,
      regexRuleCount: 0,
      enabledCount: 0,
      estimatedTokens: 0,
      scoreTotal: 0,
      scoreCount: 0,
      sourceLabel: resource.source?.site || '本地',
      sourceFormat: preset.sourceFormat || resource.format || '',
      isPresetBundle: Boolean(presetTitle || runtimeCompanion)
    };

    group.resourceIds.push(resource.id);
    group.resources.push(resource);
    if (runtimeCompanion) {
      group.runtimeCount += 1;
      group.regexRuleCount += Number(runtimeCompanion.ruleCount || 0);
    } else {
      group.moduleCount += 1;
      if (resource.payload?.enabled !== false) group.enabledCount += 1;
      group.estimatedTokens += Number(resource.diagnostics?.estimatedTokens || 0);
      const score = Number(resource.diagnostics?.score || 0);
      if (score > 0) {
        group.scoreTotal += score;
        group.scoreCount += 1;
      }
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const orderedResources = [...group.resources].sort(comparePromptResources);
      return {
        ...group,
        resources: orderedResources,
        resourceIds: orderedResources.map((resource) => resource.id),
        estimatedTokens: estimateActivePromptTokens(
          orderedResources
            .filter((resource) => !resource.payload?.extensions?.sillyTavernRuntimeCompanion)
            .map((resource) => resource.payload || {}),
          group.estimatedTokens
        ),
        score: group.scoreCount ? Math.round(group.scoreTotal / group.scoreCount) : 0
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

export function isPromptResource(resource) {
  return resource?.kind === 'prompt' || resource?.kind === 'prompt-bundle';
}

export function collapsePromptResourcesForDisplay(resources = []) {
  const list = Array.isArray(resources) ? resources : [];
  const nonPrompts = list.filter((resource) => !isPromptResource(resource));
  const promptGroups = groupPromptResources(list.filter(isPromptResource));
  const prompts = promptGroups.map((group) => {
    if (group.resources.length === 1 && group.resources[0].kind === 'prompt-bundle') {
      return group.resources[0];
    }
    if (group.resources.length === 1 && !group.isPresetBundle) return group.resources[0];
    const first = group.resources[0] || {};
    const updatedAt = group.resources
      .map((resource) => resource.updatedAt || resource.createdAt || '')
      .sort()
      .at(-1) || '';
    return {
      id: `prompt-group:${group.key}`,
      kind: 'prompt-bundle',
      title: group.title,
      summary: `${group.moduleCount + group.runtimeCount} 个内部模块${group.runtimeCount ? ` · ${group.runtimeCount} 个运行伴侣` : ''}`,
      tags: uniqueStrings(group.resources.flatMap((resource) => resource.tags || [])),
      collections: uniqueStrings(group.resources.flatMap((resource) => resource.collections || [])),
      favorite: group.resources.some((resource) => resource.favorite === true),
      format: group.sourceFormat || first.format || '',
      diagnostics: {
        ...(first.diagnostics || {}),
        score: group.score,
        estimatedTokens: group.estimatedTokens,
        stats: {
          ...(first.diagnostics?.stats || {}),
          moduleCount: group.moduleCount + group.runtimeCount,
          runtimeCompanionCount: group.runtimeCount
        }
      },
      payload: {
        schema: 'local-roleplay-agent.prompt-bundle-view/v1',
        title: group.title,
        sourceFormat: group.sourceFormat,
        promptModules: group.resources.map((resource) => resource.payload)
      },
      source: first.source || {},
      updatedAt,
      resourceIds: [...group.resourceIds],
      legacyPromptGroup: true
    };
  });
  return [...nonPrompts, ...prompts];
}

export function collectSelectedPromptResourceIds(container) {
  if (!container) return [];
  const selected = new Set();
  container.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
    const ids = parseResourceIds(input.dataset.resourceIds, input.value);
    ids.forEach((id) => selected.add(id));
  });
  return [...selected];
}

function parseResourceIds(serialized, fallback) {
  try {
    const parsed = JSON.parse(String(serialized || ''));
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to the standalone prompt resource id.
  }
  return fallback ? [String(fallback)] : [];
}

function normalizeGroupKey(value) {
  return String(value || 'preset')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, 120);
}

function comparePromptResources(left, right) {
  const leftSequence = Number(left?.payload?.extensions?.sillyTavernPreset?.sequence);
  const rightSequence = Number(right?.payload?.extensions?.sillyTavernPreset?.sequence);
  if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence)) return leftSequence - rightSequence;
  if (Number.isFinite(leftSequence)) return -1;
  if (Number.isFinite(rightSequence)) return 1;
  return 0;
}

function estimateActivePromptTokens(modules = [], fallback = 0) {
  const sourceModules = Array.isArray(modules) ? modules : [];
  const activeText = sourceModules
    .filter((module) => module?.enabled !== false)
    .map((module) => String(module?.content || ''))
    .filter((content) => content.trim())
    .join('\n');
  if (!activeText) {
    const hasMaterializedContent = sourceModules.some((module) => (
      module && Object.prototype.hasOwnProperty.call(module, 'content')
    ));
    return hasMaterializedContent ? 0 : Number(fallback || 0);
  }
  const cjkCount = (activeText.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const remainingLength = Math.max(0, activeText.length - cjkCount);
  return Math.max(1, Math.ceil(cjkCount + remainingLength / 4));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}
