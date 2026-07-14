import crypto from 'node:crypto';
import { createDefaultMemory } from '../agent/memoryUpdater.js';
import { enrichNarrativeState } from '../config/narrativeProfiles.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class SessionService {
  constructor(store) {
    this.store = store;
  }

  async getSession(sessionId = 'main') {
    const id = validateSessionId(sessionId);
    const session = await this.store.read(sessionPath(id), createSession(id));
    return enrichSessionNarrativeState(session);
  }

  async saveSession(session) {
    const id = validateSessionId(session?.id);
    return this.store.write(sessionPath(id), { ...session, id });
  }

  async listSessions() {
    const files = await this.store.list('sessions');
    return files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''));
  }

  async createSessionWithConfig({ id, title, config, memory }) {
    const sessionId = id ? validateSessionId(id) : crypto.randomUUID();
    const session = createSession(sessionId);
    session.title = title || session.title;
    session.config = config;
    if (memory && typeof memory === 'object' && !Array.isArray(memory)) {
      session.memory = structuredClone(memory);
    }
    await this.saveSession(session);
    return session;
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
    memory: createDefaultMemory(),
    settings: {
      providerId: '',
      recentPairs: 8,
      maxPromptTokens: 8000,
      maxInjectedCards: 5,
      narrativeMode: 'stable',
      theme: '',
      backgroundImage: '',
      visualContentPack: ''
    }
  };
}

function enrichSessionNarrativeState(session) {
  const next = structuredClone(session);
  const memory = next.memory && typeof next.memory === 'object' ? next.memory : createDefaultMemory();
  const packId = String(
    memory.narrativeState?.lockedGenre
    || memory.ruleSystem?.contentPackId
    || memory.worldState?.flags?.genre
    || ''
  ).trim();
  const narrativeState = enrichNarrativeState(packId, memory.narrativeState);
  if (!narrativeState) return next;
  next.memory = { ...memory, narrativeState };
  return next;
}
