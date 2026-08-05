import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { SessionService } from '../server/services/sessionService.js';
import {
  GRAPH_EDGE_TYPES,
  GRAPH_NODE_TYPES,
  GRAPH_SOURCE_AUTHORITY,
  buildSessionGraphSnapshot,
  graphNodeId
} from '../server/knowledgeGraph/graphContract.js';
import { SQLiteGraphRepository } from '../server/knowledgeGraph/sqliteGraphRepository.js';
import { KnowledgeGraphService } from '../server/knowledgeGraph/knowledgeGraphService.js';

test('session graph snapshot preserves source authority and typed relationships', () => {
  const snapshot = buildSessionGraphSnapshot(createGraphSession());
  const protagonist = snapshot.nodes.find((node) => node.properties.protagonist);
  const trustedEdge = snapshot.edges.find((edge) => edge.label === '逐渐信任');

  assert.equal(protagonist.name, '刘一');
  assert.equal(protagonist.sourceKind, 'role_card');
  assert.equal(protagonist.authority, GRAPH_SOURCE_AUTHORITY.role_card);
  assert.equal(trustedEdge.type, GRAPH_EDGE_TYPES.TRUSTS);
  assert.ok(snapshot.nodes.some((node) => node.type === GRAPH_NODE_TYPES.FACTION));
});

test('SQLite graph repository performs bounded two-hop queries and hides director facts', async () => {
  const harness = await createHarness();
  try {
    const session = createGraphSession();
    session.memory.worldState.characters.push({
      name: '暗线人',
      encountered: true,
      visibility: 'director'
    });
    session.memory.worldState.relationships.push({
      name: '暗线人',
      relationship: '幕后交易',
      visibility: 'director'
    });
    const player = harness.service.synchronizeSession(session).memory.knowledgeGraph;
    const director = harness.service.projectSession(session, { view: 'director', depth: 2 });

    assert.ok(player.nodes.some((node) => node.name === '凌霄山庄'));
    assert.ok(player.edges.some((edge) => edge.type === GRAPH_EDGE_TYPES.MEMBER_OF));
    assert.equal(player.nodes.some((node) => node.name === '暗线人'), false);
    assert.ok(director.nodes.some((node) => node.name === '暗线人'));
    assert.equal(player.depth, 2);
  } finally {
    harness.repository.close();
  }
});

test('SQLite graph repository supersedes removed snapshot facts without deleting history', async () => {
  const harness = await createHarness();
  try {
    const session = createGraphSession();
    harness.service.synchronizeSession(session);
    session.memory.worldState.relationships = [];
    session.memory.worldState.characters = [];
    const projection = harness.service.synchronizeSession(session).memory.knowledgeGraph;
    const mutations = harness.repository.listMutations(session.id);

    assert.equal(projection.edges.some((edge) => edge.label === '逐渐信任'), false);
    assert.equal(mutations.length, 2);
    assert.ok(mutations.every((mutation) => mutation.decision === 'committed'));
  } finally {
    harness.repository.close();
  }
});

test('lower-authority model proposals cannot overwrite role-card nodes', async () => {
  const harness = await createHarness();
  try {
    const session = createGraphSession();
    harness.service.synchronizeSession(session);
    const protagonistId = graphNodeId(GRAPH_NODE_TYPES.CHARACTER, '刘一');
    const result = harness.repository.applyProposal(session.id, {
      operation: 'upsert_node',
      sourceKind: 'model_inference',
      reason: 'model guessed a different identity',
      payload: {
        id: protagonistId,
        type: GRAPH_NODE_TYPES.CHARACTER,
        name: '刘一',
        properties: { role: '错误身份' }
      }
    });
    const projection = harness.service.projectSession(session, { view: 'director' });
    const protagonist = projection.nodes.find((node) => node.id === protagonistId);

    assert.equal(result.decision, 'rejected');
    assert.equal(protagonist.properties.role, '炉鼎体质');
  } finally {
    harness.repository.close();
  }
});

test('SessionService persists a compatibility projection while SQLite remains local authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nre-session-graph-'));
  const repository = new SQLiteGraphRepository({ filePath: path.join(root, 'data', 'knowledge-graph.sqlite') });
  const knowledgeGraphService = new KnowledgeGraphService({ repository });
  const service = new SessionService(new JsonStore(path.join(root, 'data')), { knowledgeGraphService });
  try {
    const session = await service.createSessionWithConfig({
      id: 'graph-session',
      title: '图谱会话',
      config: { characterCard: { id: 'card-1', name: '阿月', role: '旅人' } }
    });
    session.memory.worldState.characters = [{ name: '小林', encountered: true }];
    session.memory.worldState.relationships = [{ name: '小林', relationship: '同行' }];
    await service.saveSession(session);
    const reloaded = await service.getSession('graph-session');

    assert.equal(reloaded.memory.knowledgeGraph.storage, 'sqlite');
    assert.ok(reloaded.memory.knowledgeGraph.nodes.some((node) => node.name === '小林'));
    assert.ok(reloaded.memory.knowledgeGraph.revision >= 2);
  } finally {
    repository.close();
  }
});

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nre-graph-'));
  const repository = new SQLiteGraphRepository({ filePath: path.join(root, 'knowledge-graph.sqlite') });
  return {
    repository,
    service: new KnowledgeGraphService({ repository })
  };
}

function createGraphSession() {
  return {
    id: 'main',
    title: '测试剧本',
    messages: [{ id: 'message-1', role: 'assistant', content: '正文' }],
    config: {
      characterCard: { id: 'card-1', name: '刘一', role: '炉鼎体质' }
    },
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '', knownPlaces: [] },
        characters: [{ name: '江小鲤', role: '庄主之女', encountered: true }],
        relationships: [{
          name: '江小鲤',
          relationship: '逐渐信任',
          encountered: true,
          sourceMessageId: 'message-1'
        }],
        factions: [{ name: '凌霄山庄', character: '江小鲤', relationship: '所属' }],
        quests: []
      }
    }
  };
}
