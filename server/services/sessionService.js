import crypto from 'node:crypto';
import { createDefaultMemory } from '../agent/memoryUpdater.js';
import { enrichNarrativeState } from '../config/narrativeProfiles.js';
import { createAuthoringLedger, normalizeAuthoringLedger } from '../authoring/authoringLedger.js';
import { DEFAULT_AGENT_PROFILE_ID, normalizeAgentProfileId } from '../authoring/agentProfiles.js';
import { materializeSessionOwnedConfig } from '../config/sessionScopedConfig.js';
import { normalizeResponseLengthMode } from '../agent/responseContract.js';
import { normalizeRoleplayMode } from '../agent/roleplayMode.js';
import { createDegradedKnowledgeGraphState } from '../knowledgeGraph/knowledgeGraphService.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class SessionService {
  constructor(store, { knowledgeGraphService = null } = {}) {
    this.store = store;
    this.knowledgeGraphService = knowledgeGraphService;
  }

  async getSession(sessionId = 'main', { hydrateKnowledgeGraph = true } = {}) {
    const id = validateSessionId(sessionId);
    const session = await this.store.read(sessionPath(id), createSession(id));
    const enriched = enrichSessionNarrativeState(session);
    return hydrateKnowledgeGraph ? this.hydrateKnowledgeGraph(enriched) : enriched;
  }

  async saveSession(session) {
    const id = validateSessionId(session?.id);
    const next = await this.hydrateKnowledgeGraph({ ...session, id });
    Object.assign(session, next);
    await this.store.write(sessionPath(id), next);
    return next;
  }

  async listSessions() {
    const files = await this.store.list('sessions');
    return files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''));
  }

  async listSessionSummaries() {
    const sessionIds = await this.listSessions();
    const sessions = await Promise.all(sessionIds.map((sessionId) => this.getSession(sessionId)));
    return sessions
      .map(summarizeSession)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async createSessionWithConfig({ id, title, config, memory, storyProjectId = '', basePackId = '' }) {
    const sessionId = id ? validateSessionId(id) : crypto.randomUUID();
    const session = createSession(sessionId);
    session.title = title || session.title;
    session.config = materializeSessionOwnedConfig(config);
    session.storyProjectId = cleanSessionReference(storyProjectId);
    session.basePackId = cleanSessionReference(basePackId);
    if (memory && typeof memory === 'object' && !Array.isArray(memory)) {
      session.memory = structuredClone(memory);
    }
    await this.saveSession(session);
    return session;
  }

  async hydrateKnowledgeGraph(session) {
    if (!this.knowledgeGraphService) return session;
    try {
      return this.knowledgeGraphService.synchronizeSession(session);
    } catch (error) {
      return createDegradedKnowledgeGraphState(session, error);
    }
  }
}

function sessionPath(sessionId) {
  return `sessions/${validateSessionId(sessionId)}.json`;
}

function validateSessionId(sessionId) {
  const id = String(sessionId ?? '');
  if (!SESSION_ID_PATTERN.test(id)) throw new Error('Invalid session id');
  return id;
}

function createSession(id) {
  return {
    id,
    title: '新的江湖',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    usageLedger: [],
    memory: createDefaultMemory(),
    authoring: createAuthoringLedger(),
    settings: {
      providerId: '',
      taskProviderOverrides: {},
      taskFallbackOverrides: {},
      recentPairs: 8,
      maxPromptTokens: 8000,
      maxInjectedCards: 5,
      narrativeMode: 'stable',
      roleplayMode: 'dm',
      responseLength: 'balanced',
      worldBookIncludeNames: true,
      worldBookCaseSensitive: false,
      worldBookMatchWholeWords: false,
      worldBookMinActivations: 0,
      worldBookMinActivationsDepthMax: 0,
      activeAgentProfileId: DEFAULT_AGENT_PROFILE_ID,
      theme: '',
      backgroundImage: '',
      visualContentPack: ''
    }
  };
}

function enrichSessionNarrativeState(session) {
  const next = structuredClone(session);
  next.usageLedger = Array.isArray(next.usageLedger) ? next.usageLedger : [];
  next.authoring = normalizeAuthoringLedger(next.authoring);
  next.settings = next.settings && typeof next.settings === 'object' ? next.settings : {};
  next.settings.activeAgentProfileId = normalizeAgentProfileId(next.settings.activeAgentProfileId);
  next.settings.roleplayMode = normalizeRoleplayMode(next.settings.roleplayMode);
  next.settings.responseLength = normalizeResponseLengthMode(next.settings.responseLength);
  const memory = next.memory && typeof next.memory === 'object' ? next.memory : createDefaultMemory();
  const packId = String(
    memory.narrativeState?.lockedGenre
    || memory.ruleSystem?.contentPackId
    || memory.worldState?.flags?.genre
    || ''
  ).trim();
  const narrativeState = enrichNarrativeState(packId, memory.narrativeState);
  next.memory = narrativeState ? { ...memory, narrativeState } : memory;
  return next;
}

function summarizeSession(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const lastMessage = messages.at(-1);
  const memory = session.memory && typeof session.memory === 'object' ? session.memory : {};
  const packId = String(
    session.basePackId
    || memory.resourcePackId
    || memory.ruleSystem?.contentPackId
    || memory.worldState?.flags?.genre
    || ''
  ).trim();
  return {
    id: session.id,
    title: session.title || session.id,
    storyProjectId: cleanSessionReference(session.storyProjectId),
    basePackId: cleanSessionReference(session.basePackId) || packId,
    packId,
    messageCount: messages.length,
    lastMessagePreview: String(lastMessage?.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || session.createdAt || ''
  };
}

function cleanSessionReference(value) {
  const id = String(value || '').trim();
  return SESSION_ID_PATTERN.test(id) ? id : '';
}
