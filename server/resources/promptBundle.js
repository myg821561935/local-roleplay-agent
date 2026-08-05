import { normalizePromptModule } from '../config/configService.js';

export const PROMPT_BUNDLE_KIND = 'prompt-bundle';
export const PROMPT_BUNDLE_SCHEMA = 'local-roleplay-agent.prompt-bundle/v1';

export function createPromptBundlePayload({
  title = '',
  sourceKind = 'prompt-preset',
  preset = {},
  promptModules = []
} = {}) {
  return {
    schema: PROMPT_BUNDLE_SCHEMA,
    title: String(preset.title || title || '导入的预设').trim(),
    sourceKind: String(sourceKind || 'prompt-preset'),
    sourceFormat: String(preset.sourceFormat || '').trim(),
    generationSettings: cloneObject(preset.generationSettings),
    promptLayout: cloneArray(preset.promptLayout),
    dependencySignals: cloneObject(preset.dependencySignals),
    regexCompatibility: cloneObject(preset.regexCompatibility),
    promptModules: (Array.isArray(promptModules) ? promptModules : [])
      .map((module) => normalizePromptModule(module || {}))
  };
}

export function isPromptBundleResource(resource) {
  return resource?.kind === PROMPT_BUNDLE_KIND
    && Array.isArray(resource.payload?.promptModules);
}

export function expandPromptResourceModules(resource) {
  if (isPromptBundleResource(resource)) {
    return resource.payload.promptModules.map((module) => normalizePromptModule(module || {}));
  }
  if (resource?.kind === 'prompt') {
    return [normalizePromptModule(resource.payload || {})];
  }
  return [];
}

export function countPromptResourceModules(resource) {
  return expandPromptResourceModules(resource).length;
}

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function cloneArray(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}
