export const RESOURCE_PRESET_KEYS = Object.freeze({
  characterPrefix: 'resource-character:',
  promptPrefix: 'resource-prompt-batch:',
  worldbookPrefix: 'resource-worldbook:',
  characterGroupId: 'resource-library-character-group',
  promptGroupId: 'resource-library-prompt-group',
  worldbookGroupId: 'resource-library-worldbook-group'
});

export function buildResourcePresetCatalog(resources = []) {
  const list = Array.isArray(resources) ? resources : [];
  const characters = list.filter((resource) => (
    resource?.kind === 'character' && isObject(resource.payload)
  ));
  const worldBooks = list.filter((resource) => (
    resource?.kind === 'worldbook' && Array.isArray(resource.payload?.entries)
  ));
  const promptBundles = new Map();

  for (const resource of list) {
    if (!['prompt', 'prompt-bundle'].includes(resource?.kind) || !isObject(resource.payload)) continue;
    if (resource.kind === 'prompt-bundle') {
      const promptModules = Array.isArray(resource.payload.promptModules)
        ? resource.payload.promptModules
        : [];
      promptBundles.set(`bundle-${resource.id}`, {
        id: `bundle-${resource.id}`,
        title: String(resource.payload.title || resource.title || '导入的 Prompt'),
        resources: [resource],
        promptModules,
        moduleCount: promptModules.length
      });
      continue;
    }
    const batchId = String(resource.source?.importBatchId || `single-${resource.id || ''}`);
    const title = String(
      resource.collections?.[0]
      || resource.source?.fileName?.replace(/\.(?:json|ya?ml)$/i, '')
      || resource.title
      || '导入的 Prompt'
    );
    if (!promptBundles.has(batchId)) promptBundles.set(batchId, { id: batchId, title, resources: [] });
    promptBundles.get(batchId).resources.push(resource);
  }

  return {
    characters,
    worldBooks,
    promptBundles: [...promptBundles.values()].map((bundle) => {
      const resources = [...bundle.resources].sort(comparePromptResources);
      return {
        ...bundle,
        resources,
        promptModules: bundle.promptModules || resources.map((resource) => resource.payload),
        moduleCount: bundle.moduleCount ?? resources.length
      };
    })
  };
}

export function getResourceSelectionId(value, prefix) {
  const text = String(value || '');
  return text.startsWith(prefix) ? text.slice(prefix.length) : '';
}

export function renderResourceOptionGroup({
  select,
  documentObject,
  groupId,
  groupLabel,
  options = [],
  preservePrefix = ''
} = {}) {
  if (!select || !documentObject?.createElement) return false;
  const current = select.value;
  removeOptionGroup(select, groupId);
  if (!options.length) {
    if (preservePrefix && String(current || '').startsWith(preservePrefix)) select.value = '';
    return false;
  }

  const group = documentObject.createElement('optgroup');
  group.id = groupId;
  group.label = groupLabel;
  for (const item of options) {
    const option = documentObject.createElement('option');
    option.value = String(item.value || '');
    option.textContent = String(item.label || '未命名素材');
    group.append(option);
  }
  select.append(group);
  if (preservePrefix && String(current || '').startsWith(preservePrefix)) select.value = current;
  return true;
}

function removeOptionGroup(select, groupId) {
  const existing = select.querySelector?.(`#${groupId}`);
  if (existing?.remove) {
    existing.remove();
    return;
  }
  const children = Array.from(select.children || []);
  if (children.some((child) => child?.id === groupId)) {
    select.replaceChildren(...children.filter((child) => child?.id !== groupId));
  }
}

function comparePromptResources(left, right) {
  const leftSequence = Number(left.payload?.extensions?.sillyTavernPreset?.sequence);
  const rightSequence = Number(right.payload?.extensions?.sillyTavernPreset?.sequence);
  if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence)) return leftSequence - rightSequence;
  if (Number.isFinite(leftSequence)) return -1;
  if (Number.isFinite(rightSequence)) return 1;
  return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
