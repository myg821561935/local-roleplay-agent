import {
  normalizePromptModule,
  normalizeWorldBookEntry
} from '../../config/configService.js';
import {
  createFingerprint,
  normalizeTitle
} from './resourceConflictService.js';

const BASE_INHERITANCE_MODES = new Set(['full', 'genre', 'none']);
const STORY_SPECIFIC_PROMPT_PATTERN = /(?:world[-_ ]?premise|core[-_ ]?route|main[-_ ]?line|opening|prologue|固定主线|开局|世界观基调|旧案主线)/i;

export class StoryCompositionService {
  constructor({ createEmptyPackSeed }) {
    this.createEmptyPackSeed = createEmptyPackSeed;
  }

  normalizeWorldBookMergeMode(value) {
    return ['smart', 'base-first', 'resources-only'].includes(String(value || ''))
      ? String(value)
      : 'smart';
  }

  normalizeBaseInheritanceMode(value, includeBaseContent = true) {
    if (includeBaseContent === false) return 'none';
    const mode = String(value || '').trim().toLowerCase();
    return BASE_INHERITANCE_MODES.has(mode) ? mode : 'full';
  }

  selectInheritedWorldBook(entries = [], mode = 'full') {
    if (mode === 'none') return [];
    if (mode === 'full') return structuredClone(entries || []);
    return structuredClone((entries || []).filter((entry) => {
      const scope = String(entry?.extensions?.inheritanceScope || entry?.inheritanceScope || '').trim().toLowerCase();
      return scope === 'genre' || scope === 'global';
    }));
  }

  selectInheritedPromptModules(modules = [], mode = 'full') {
    if (mode === 'none') return [];
    if (mode === 'full') return structuredClone(modules || []);
    return structuredClone((modules || []).filter((module) => {
      const scope = String(module?.extensions?.inheritanceScope || module?.inheritanceScope || '').trim().toLowerCase();
      if (scope === 'story' || scope === 'none') return false;
      if (scope === 'genre' || scope === 'global') return true;
      const identity = [module?.id, module?.title].filter(Boolean).join(' ');
      return !STORY_SPECIFIC_PROMPT_PATTERN.test(identity);
    }));
  }

  createComposedMemory(base, id, mode = 'full') {
    if (mode === 'full') {
      return {
        ...structuredClone(base.memory || {}),
        resourcePackId: id
      };
    }
    const seed = this.createEmptyPackSeed(id).memory;
    const genre = String(
      base.memory?.worldState?.flags?.genre
      || base.memory?.worldState?.genre
      || base.id
      || 'custom'
    ).trim() || 'custom';
    return {
      ...seed,
      resourcePackId: id,
      worldState: {
        ...seed.worldState,
        genre,
        flags: {
          ...(seed.worldState?.flags || {}),
          genre
        }
      }
    };
  }

  createComposedRuleSystem(base, id, mode = 'full', sourcePackId = '') {
    if (mode === 'full') {
      return {
        ...structuredClone(base.ruleSystem || this.createEmptyPackSeed(id).ruleSystem),
        contentPackId: id,
        sourceContentPackId: sourcePackId
      };
    }
    const seed = this.createEmptyPackSeed(id).ruleSystem;
    const genreLabel = String(base.title || '题材基线').trim();
    return {
      ...seed,
      title: mode === 'genre' ? `${genreLabel} · 通用规则` : seed.title,
      boundary: mode === 'genre'
        ? '角色卡及其同批世界书决定人物、地点、关系、故事前提与行文风格；题材基线只提供通用世界规则。'
        : seed.boundary,
      contentPackId: id,
      sourceContentPackId: mode === 'genre' ? sourcePackId : '',
      panels: []
    };
  }

  composeWorldBookEntries({ baseEntries = [], resourceGroups = [], mode = 'smart' } = {}) {
    const mergeMode = this.normalizeWorldBookMergeMode(mode);
    const candidates = [];
    if (mergeMode !== 'resources-only') {
      (baseEntries || []).forEach((entry) => candidates.push({
        entry: normalizeWorldBookEntry(entry),
        origin: 'base',
        resourceId: '',
        resourceTitle: '题材基线'
      }));
    }
    (resourceGroups || []).forEach((group) => {
      (group.entries || []).forEach((entry) => candidates.push({
        entry: normalizeWorldBookEntry(entry),
        origin: 'resource',
        resourceId: group.resourceId || '',
        resourceTitle: group.title || '补充世界书'
      }));
    });

    const accepted = [];
    const conflicts = [];
    let exactDuplicates = 0;
    let sameTitleConflicts = 0;
    let constantConflicts = 0;
    let triggerOverlaps = 0;
    let replacedBaseEntries = 0;
    let skippedSelectedEntries = 0;

    candidates.forEach((candidate) => {
      const fingerprint = createFingerprint(candidate.entry);
      const exact = accepted.find((item) => item.fingerprint === fingerprint);
      if (exact) {
        exactDuplicates += 1;
        return;
      }

      const titleKey = normalizeTitle(candidate.entry.title);
      const sameTitleIndex = titleKey
        ? accepted.findIndex((item) => normalizeTitle(item.entry.title) === titleKey)
        : -1;
      if (sameTitleIndex >= 0) {
        const previous = accepted[sameTitleIndex];
        const constant = previous.entry.constant === true || candidate.entry.constant === true;
        if (constant) constantConflicts += 1;
        else sameTitleConflicts += 1;
        conflicts.push({
          type: constant ? 'constant-conflict' : 'same-title-conflict',
          title: candidate.entry.title,
          message: `${candidate.entry.title}：${previous.resourceTitle}与${candidate.resourceTitle}内容不同`,
          baseOrigin: previous.origin,
          resourceId: candidate.resourceId
        });
        const selectedCanReplace = mergeMode === 'smart' && candidate.origin === 'resource';
        if (selectedCanReplace) {
          if (previous.origin === 'base') replacedBaseEntries += 1;
          accepted[sameTitleIndex] = { ...candidate, fingerprint };
        } else {
          skippedSelectedEntries += candidate.origin === 'resource' ? 1 : 0;
        }
        return;
      }

      const candidateTriggers = getWorldBookTriggers(candidate.entry);
      if (candidateTriggers.size && candidate.origin === 'resource') {
        const overlap = accepted.find((item) => item.origin !== candidate.origin
          && setsIntersect(candidateTriggers, getWorldBookTriggers(item.entry)));
        if (overlap) {
          triggerOverlaps += 1;
          conflicts.push({
            type: 'trigger-overlap',
            title: candidate.entry.title,
            message: `${candidate.entry.title}与${overlap.entry.title}共享触发词，可能同时注入`,
            resourceId: candidate.resourceId
          });
        }
      }
      accepted.push({ ...candidate, fingerprint });
    });

    return {
      entries: accepted.map((item) => item.entry),
      report: {
        mode: mergeMode,
        summary: {
          baseEntries: mergeMode === 'resources-only' ? 0 : Number(baseEntries?.length || 0),
          selectedEntries: (resourceGroups || []).reduce((sum, group) => sum + Number(group.entries?.length || 0), 0),
          finalEntries: accepted.length,
          exactDuplicates,
          sameTitleConflicts,
          constantConflicts,
          triggerOverlaps,
          replacedBaseEntries,
          skippedSelectedEntries
        },
        conflicts
      }
    };
  }

  composePromptModules({ baseModules = [], resources = [] } = {}) {
    const candidates = [
      ...(baseModules || []).map((item) => ({
        module: normalizePromptModule(item),
        origin: 'base',
        resourceId: '',
        resourceTitle: '题材基线'
      })),
      ...(resources || []).map((resource) => ({
        module: normalizePromptModule(resource.payload || {}),
        origin: 'resource',
        resourceId: resource.id || '',
        resourceTitle: resource.title || '补充预设'
      }))
    ];
    const accepted = [];
    const conflicts = [];
    let promptExactDuplicates = 0;
    let promptIdConflicts = 0;
    let replacedPromptModules = 0;

    candidates.forEach((candidate) => {
      const fingerprint = createFingerprint(candidate.module);
      if (accepted.some((item) => item.fingerprint === fingerprint)) {
        promptExactDuplicates += 1;
        return;
      }

      const idKey = normalizeTitle(candidate.module.id || candidate.module.title);
      const sameIdIndex = idKey
        ? accepted.findIndex((item) => normalizeTitle(item.module.id || item.module.title) === idKey)
        : -1;
      if (sameIdIndex >= 0) {
        const previous = accepted[sameIdIndex];
        promptIdConflicts += 1;
        conflicts.push({
          type: 'prompt-id-conflict',
          title: candidate.module.title || candidate.module.id,
          message: `${candidate.module.title || candidate.module.id}：${previous.resourceTitle}与${candidate.resourceTitle}使用相同模块 ID`,
          resourceId: candidate.resourceId
        });
        if (candidate.origin === 'resource') {
          accepted[sameIdIndex] = { ...candidate, fingerprint };
          replacedPromptModules += 1;
        }
        return;
      }
      accepted.push({ ...candidate, fingerprint });
    });

    return {
      modules: accepted.map((item) => item.module),
      report: {
        summary: {
          basePromptModules: Number(baseModules?.length || 0),
          selectedPromptModules: Number(resources?.length || 0),
          finalPromptModules: accepted.length,
          promptExactDuplicates,
          promptIdConflicts,
          replacedPromptModules
        },
        conflicts
      }
    };
  }
}

function getWorldBookTriggers(entry) {
  return new Set([
    ...(entry.keywords || []),
    ...(entry.secondaryKeywords || []),
    ...(entry.regex || [])
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function setsIntersect(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}
