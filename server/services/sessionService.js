import { createDefaultMemory } from '../agent/memoryUpdater.js';

export class SessionService {
  constructor(store) {
    this.store = store;
  }

  async getSession(sessionId = 'main') {
    return this.store.read(`sessions/${sessionId}.json`, createSession(sessionId));
  }

  async saveSession(session) {
    return this.store.write(`sessions/${session.id}.json`, session);
  }

  async listSessions() {
    const files = await this.store.list('sessions');
    return files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''));
  }
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
