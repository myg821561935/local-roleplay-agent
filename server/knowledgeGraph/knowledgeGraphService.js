import { GRAPH_SCHEMA_VERSION, buildSessionGraphSnapshot } from './graphContract.js';

export class KnowledgeGraphService {
  constructor({ repository, now = () => new Date() } = {}) {
    if (!repository) throw new TypeError('Knowledge graph repository is required');
    this.repository = repository;
    this.now = now;
  }

  previewSession(session) {
    const snapshot = buildSessionGraphSnapshot(session, { now: this.now });
    const stored = this.repository.getSessionMetadata(snapshot.sessionId);
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      sessionId: snapshot.sessionId,
      fingerprint: snapshot.fingerprint,
      changed: stored?.fingerprint !== snapshot.fingerprint,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      previousRevision: Number(stored?.revision || 0),
      protagonistId: snapshot.protagonistId
    };
  }

  synchronizeSession(session) {
    const snapshot = buildSessionGraphSnapshot(session, { now: this.now });
    const metadata = this.repository.syncSnapshot(snapshot);
    const projection = this.projectSnapshot(snapshot.sessionId, {
      focusNodeId: metadata.protagonistId || snapshot.protagonistId,
      view: 'player',
      depth: 2
    });
    return attachKnowledgeGraph(session, projection);
  }

  projectSession(session, { view = 'player', depth = 2 } = {}) {
    const snapshot = buildSessionGraphSnapshot(session, { now: this.now });
    const metadata = this.repository.syncSnapshot(snapshot);
    return this.projectSnapshot(snapshot.sessionId, {
      focusNodeId: metadata.protagonistId || snapshot.protagonistId,
      view,
      depth
    });
  }

  projectSnapshot(sessionId, { focusNodeId = '', view = 'player', depth = 2 } = {}) {
    const metadata = this.repository.getSessionMetadata(sessionId) || {};
    const graph = this.repository.queryNeighborhood(sessionId, {
      focusNodeId: focusNodeId || metadata.protagonistId,
      view: view === 'director' ? 'director' : 'player',
      depth
    });
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      storage: 'sqlite',
      sessionId,
      revision: Number(metadata.revision || 0),
      fingerprint: metadata.fingerprint || '',
      protagonistId: focusNodeId || metadata.protagonistId || '',
      view: view === 'director' ? 'director' : 'player',
      depth: clampDepth(depth),
      generatedAt: this.now().toISOString(),
      nodes: graph.nodes,
      edges: graph.edges
    };
  }

  listMutations(sessionId, options) {
    return this.repository.listMutations(sessionId, options);
  }
}

export function attachKnowledgeGraph(session, projection) {
  const next = structuredClone(session);
  next.memory = next.memory && typeof next.memory === 'object' ? next.memory : {};
  next.memory.knowledgeGraph = structuredClone(projection);
  return next;
}

export function createDegradedKnowledgeGraphState(session, error) {
  const next = structuredClone(session);
  next.memory = next.memory && typeof next.memory === 'object' ? next.memory : {};
  next.memory.knowledgeGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    storage: 'sqlite',
    sessionId: String(session?.id || 'main'),
    syncState: 'degraded',
    error: String(error?.code || error?.message || 'KNOWLEDGE_GRAPH_SYNC_FAILED').slice(0, 160),
    nodes: [],
    edges: []
  };
  return next;
}

function clampDepth(value) {
  const depth = Number(value);
  return Number.isFinite(depth) ? Math.max(0, Math.min(4, Math.floor(depth))) : 2;
}
