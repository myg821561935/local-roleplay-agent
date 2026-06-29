import { createDefaultMemory } from '../agent/memoryUpdater.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class SessionService {
  constructor(store) {
    this.store = store;
  }

  async getSession(sessionId = 'main') {
    const id = validateSessionId(sessionId);
    return this.store.read(sessionPath(id), createSession(id));
  }

  async saveSession(session) {
    const id = validateSessionId(session?.id);
    return this.store.write(sessionPath(id), { ...session, id });
  }

  async listSessions() {
    const files = await this.store.list('sessions');
    return files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''));
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
      recentPairs: 8,
      maxPromptTokens: 8000,
      maxInjectedCards: 5
    }
  };
}
