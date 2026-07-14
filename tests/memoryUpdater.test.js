import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultMemory, rebuildMemoryFromMessages } from '../server/agent/memoryUpdater.js';

test('default memory contains a durable narrative state', () => {
  const memory = createDefaultMemory();

  assert.deepEqual(memory.narrativeState, {
    activeArc: '',
    corePillars: [],
    supportingElements: [],
    forbiddenDominance: [],
    supportingArcs: [],
    routeReturnRule: '',
    lockedGenre: '',
    referenceFocus: [],
    lastConfirmedBy: ''
  });
});

test('message rebuild preserves the active narrative route', () => {
  const memory = createDefaultMemory();
  memory.narrativeState = {
    activeArc: '查清听雪峰旧案',
    supportingArcs: ['落雷秘境'],
    lockedGenre: 'xianxia',
    lastConfirmedBy: 'user'
  };

  const rebuilt = rebuildMemoryFromMessages({
    memory,
    messages: [
      { id: 'u1', role: 'user', content: '继续调查。' },
      { id: 'a1', role: 'assistant', content: '卷宗又少了一页。' }
    ]
  });

  assert.deepEqual(rebuilt.narrativeState, memory.narrativeState);
});
