import crypto from 'node:crypto';

const PROJECT_DIR = 'projects';
const PROJECT_SPEC = 'lra.story-project/v1';
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const DEFAULT_RUNTIME_POLICY = Object.freeze({
  narrativeMode: 'stable',
  maxPromptTokens: 8000,
  maxInjectedCards: 15
});

export class StoryProjectService {
  constructor(store) {
    this.store = store;
  }

  async listProjects() {
    const files = await this.store.list(PROJECT_DIR);
    const projects = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => this.store.read(`${PROJECT_DIR}/${file}`, null))
    );
    return projects
      .filter(Boolean)
      .map(normalizeStoredProject)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async getProject(projectId) {
    const id = validateProjectId(projectId);
    const project = await this.store.read(projectPath(id), null);
    return project ? normalizeStoredProject(project) : null;
  }

  async createProject(input = {}) {
    const id = input.id ? validateProjectId(input.id) : `story-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const project = normalizeStoredProject({
      spec: PROJECT_SPEC,
      id,
      title: input.title,
      description: input.description,
      basePackId: input.basePackId,
      basePackTitle: input.basePackTitle,
      basePackVersion: input.basePackVersion,
      visualPackId: input.visualPackId,
      bindings: input.bindings,
      runtimePolicy: input.runtimePolicy,
      sessionIds: [],
      activeSessionId: '',
      createdAt: timestamp,
      updatedAt: timestamp
    });
    if (!project.basePackId) throw new Error('STORY_PROJECT_BASE_PACK_REQUIRED');
    await this.store.write(projectPath(id), project);
    return structuredClone(project);
  }

  async saveProject(project) {
    const id = validateProjectId(project?.id);
    const current = await this.getProject(id);
    if (!current) throw new Error('STORY_PROJECT_NOT_FOUND');
    const next = normalizeStoredProject({
      ...current,
      ...structuredClone(project),
      id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    await this.store.write(projectPath(id), next);
    return structuredClone(next);
  }

  async deleteProject(projectId) {
    const id = validateProjectId(projectId);
    const current = await this.getProject(id);
    if (!current) return null;
    await this.store.remove(projectPath(id));
    return structuredClone(current);
  }

  async attachSession(projectId, sessionId) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('STORY_PROJECT_NOT_FOUND');
    const safeSessionId = validateSessionReference(sessionId);
    project.sessionIds = Array.from(new Set([...project.sessionIds, safeSessionId]));
    project.activeSessionId = safeSessionId;
    return this.saveProject(project);
  }
}

export function summarizeStoryProject(project) {
  const normalized = normalizeStoredProject(project);
  return {
    id: normalized.id,
    title: normalized.title,
    description: normalized.description,
    basePackId: normalized.basePackId,
    basePackTitle: normalized.basePackTitle,
    basePackVersion: normalized.basePackVersion,
    visualPackId: normalized.visualPackId,
    lifecycle: normalized.lifecycle,
    lifecycleState: normalized.lifecycle.state,
    canCreateSession: normalized.lifecycle.state === 'active' && Boolean(normalized.basePackId),
    activeSessionId: normalized.activeSessionId,
    sessionCount: normalized.sessionIds.length,
    updatedAt: normalized.updatedAt,
    createdAt: normalized.createdAt
  };
}

function normalizeStoredProject(project = {}) {
  const id = validateProjectId(project.id);
  const sessionIds = Array.isArray(project.sessionIds)
    ? project.sessionIds.map(validateSessionReference)
    : [];
  const activeSessionId = project.activeSessionId
    ? validateSessionReference(project.activeSessionId)
    : '';
  return {
    spec: PROJECT_SPEC,
    id,
    title: cleanText(project.title, 100) || '未命名故事',
    description: cleanText(project.description, 500),
    basePackId: cleanId(project.basePackId),
    basePackTitle: cleanText(project.basePackTitle, 100),
    basePackVersion: cleanText(project.basePackVersion, 40) || '1.0.0',
    visualPackId: cleanId(project.visualPackId || project.basePackId),
    bindings: normalizeBindings(project.bindings),
    runtimePolicy: normalizeRuntimePolicy(project.runtimePolicy),
    lifecycle: normalizeProjectLifecycle(project.lifecycle),
    sessionIds: Array.from(new Set(sessionIds)),
    activeSessionId: activeSessionId || sessionIds.at(-1) || '',
    createdAt: cleanText(project.createdAt, 60) || new Date().toISOString(),
    updatedAt: cleanText(project.updatedAt, 60) || new Date().toISOString()
  };
}

function normalizeProjectLifecycle(lifecycle = {}) {
  const detached = lifecycle?.state === 'detached';
  return {
    state: detached ? 'detached' : 'active',
    detachedAt: detached ? cleanText(lifecycle.detachedAt, 60) : '',
    reason: detached ? cleanText(lifecycle.reason, 80) : '',
    sourcePack: detached ? normalizeSourcePack(lifecycle.sourcePack) : null
  };
}

function normalizeSourcePack(pack = {}) {
  return {
    id: cleanId(pack.id),
    title: cleanText(pack.title, 100),
    version: cleanText(pack.version, 40) || '1.0.0',
    visualPackId: cleanId(pack.visualPackId)
  };
}

function normalizeBindings(bindings = {}) {
  return {
    protagonistResourceId: cleanId(bindings.protagonistResourceId),
    npcResourceIds: uniqueIds(bindings.npcResourceIds),
    loreModuleIds: uniqueIds(bindings.loreModuleIds),
    ruleModuleIds: uniqueIds(bindings.ruleModuleIds),
    stylePromptIds: uniqueIds(bindings.stylePromptIds),
    scenarioModuleIds: uniqueIds(bindings.scenarioModuleIds)
  };
}

function normalizeRuntimePolicy(policy = {}) {
  const narrativeMode = ['free', 'stable', 'strict'].includes(policy.narrativeMode)
    ? policy.narrativeMode
    : DEFAULT_RUNTIME_POLICY.narrativeMode;
  return {
    narrativeMode,
    maxPromptTokens: clampInteger(policy.maxPromptTokens, 1000, 200000, DEFAULT_RUNTIME_POLICY.maxPromptTokens),
    maxInjectedCards: clampInteger(policy.maxInjectedCards, 1, 200, DEFAULT_RUNTIME_POLICY.maxInjectedCards)
  };
}

function uniqueIds(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map(cleanId).filter(Boolean)));
}

function cleanId(value) {
  return String(value || '').trim().slice(0, 160);
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function projectPath(projectId) {
  return `${PROJECT_DIR}/${validateProjectId(projectId)}.json`;
}

function validateProjectId(projectId) {
  const id = String(projectId ?? '');
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error('STORY_PROJECT_ID_INVALID');
  return id;
}

function validateSessionReference(sessionId) {
  const id = String(sessionId ?? '');
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error('STORY_PROJECT_SESSION_ID_INVALID');
  return id;
}
