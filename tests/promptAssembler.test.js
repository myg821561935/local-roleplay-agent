import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { estimateTokens } from '../server/agent/token.js';

test('estimateTokens gives non-zero estimate for Chinese text', () => {
  assert.equal(estimateTokens('神荒武界'), 4);
});

test('assemblePrompt includes modules, state, summary, matched world book, and recent messages', () => {
  const result = assemblePrompt({
    promptModules: [{ id: 'core', title: '核心', enabled: true, content: '保持角色一致。' }],
    worldBook: [{
      id: 'wb-1',
      title: '镇武司',
      keywords: ['镇武司'],
      content: '镇武司负责约束江湖武人。',
      priority: 80,
      enabled: true
    }],
    memory: {
      rollingSummary: '主角刚到城中。',
      worldState: { protagonist: { name: '李青' }, location: { current: '云州城' } },
      memoryCards: []
    },
    messages: [
      { role: 'user', content: '我走进云州城。' },
      { role: 'assistant', content: '城门外风雪未歇。' }
    ],
    userMessage: '我要去镇武司附近打探消息。',
    options: { recentPairs: 4, maxPromptTokens: 2000, maxInjectedCards: 3 }
  });

  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.injectedCards.length, 1);
  assert.match(result.messages[0].content, /保持角色一致/);
  assert.match(result.messages[0].content, /镇武司负责约束江湖武人/);
  assert.match(result.messages[0].content, /云州城/);
});
