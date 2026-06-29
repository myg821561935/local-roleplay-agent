import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveCards } from '../server/agent/memoryRetriever.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { estimateTokens } from '../server/agent/token.js';

test('estimateTokens gives non-zero estimate for Chinese text', () => {
  assert.equal(estimateTokens('神荒武界'), 4);
});

test('assemblePrompt includes modules, state, summary, matched world book, and recent messages', () => {
  const result = assemblePrompt({
    promptModules: [
      { id: 'core', title: '核心', enabled: true, content: '保持角色一致。' },
      { id: 'disabled', title: '禁用', enabled: false, content: '不应注入。' },
      { id: 'empty', title: '空内容', enabled: true, content: '   ' }
    ],
    characterCard: {
      name: '沈观澜',
      role: '游侠',
      description: '初入江湖的刀客。',
      personality: '沉稳，重诺。',
      scenario: '正在调查镇武司旧案。',
      exampleDialog: ['用户：你是谁？', '沈观澜：过路人。'],
      enabled: true
    },
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
    options: { recentPairs: 4, maxInjectedCards: 3 }
  });

  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.messages.at(-1).content, '我要去镇武司附近打探消息。');
  assert.equal(result.injectedCards.length, 1);
  assert.match(result.messages[0].content, /保持角色一致/);
  assert.match(result.messages[0].content, /# 角色卡/);
  assert.match(result.messages[0].content, /沈观澜/);
  assert.match(result.messages[0].content, /正在调查镇武司旧案/);
  assert.match(result.messages[0].content, /<recommended_actions>/);
  assert.match(result.messages[0].content, /镇武司负责约束江湖武人/);
  assert.match(result.messages[0].content, /云州城/);
  assert.match(result.messages[0].content, /主角刚到城中。/);
  assert.ok(result.messages.some((message) => message.content === '我走进云州城。'));
  assert.ok(result.messages.some((message) => message.content === '城门外风雪未歇。'));
  assert.deepEqual(result.sections.promptModules, ['core']);
  assert.equal(result.sections.hasCharacterCard, true);
});

test('retrieveCards ignores cards without keyword matches', () => {
  const card = {
    id: 'wb-1',
    title: '镇武司',
    keywords: ['镇武司'],
    content: '镇武司负责约束江湖武人。',
    priority: 100,
    enabled: true
  };

  assert.deepEqual(retrieveCards({ query: '无关文本', worldBook: [card], memoryCards: [] }), []);
});

test('retrieveCards ignores disabled cards and cards with empty content', () => {
  const disabledCard = {
    id: 'disabled',
    title: '禁用',
    keywords: ['镇武司'],
    content: '不应返回。',
    priority: 100,
    enabled: false
  };
  const emptyCard = {
    id: 'empty',
    title: '空内容',
    keywords: ['镇武司'],
    content: '   ',
    priority: 100,
    enabled: true
  };

  assert.deepEqual(retrieveCards({ query: '镇武司', worldBook: [disabledCard], memoryCards: [emptyCard] }), []);
});

test('retrieveCards caps results with maxCards', () => {
  const cards = [
    cardFixture({ id: 'first', title: 'First', priority: 30 }),
    cardFixture({ id: 'second', title: 'Second', priority: 20 }),
    cardFixture({ id: 'third', title: 'Third', priority: 10 })
  ];

  const result = retrieveCards({ query: '镇武司', worldBook: cards, maxCards: 2 });

  assert.deepEqual(result.map((card) => card.id), ['first', 'second']);
});

test('retrieveCards prefers higher priority when keyword hits are equal', () => {
  const result = retrieveCards({
    query: '镇武司',
    worldBook: [
      cardFixture({ id: 'low', title: 'Low', priority: 10 }),
      cardFixture({ id: 'high', title: 'High', priority: 90 })
    ]
  });

  assert.deepEqual(result.map((card) => card.id), ['high', 'low']);
});

test('retrieveCards sorts equal scores by title', () => {
  const result = retrieveCards({
    query: '镇武司',
    worldBook: [
      cardFixture({ id: 'beta', title: 'Beta', priority: 50 }),
      cardFixture({ id: 'alpha', title: 'Alpha', priority: 50 })
    ]
  });

  assert.deepEqual(result.map((card) => card.id), ['alpha', 'beta']);
});

test('retrieveCards handles null inputs as empty defaults', () => {
  assert.deepEqual(retrieveCards(), []);
  assert.deepEqual(retrieveCards({ query: '镇武司', worldBook: null, memoryCards: null }), []);
});

test('assemblePrompt handles null collections and still appends final user message', () => {
  let result;
  assert.doesNotThrow(() => {
    result = assemblePrompt({
      promptModules: null,
      worldBook: null,
      memory: null,
      messages: null,
      userMessage: '继续前进。'
    });
  });

  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.messages.at(-1).content, '继续前进。');
  assert.deepEqual(result.injectedCards, []);
  assert.deepEqual(result.sections.promptModules, []);
});

function cardFixture(patch = {}) {
  return {
    id: 'card',
    title: 'Card',
    keywords: ['镇武司'],
    content: '镇武司负责约束江湖武人。',
    priority: 50,
    enabled: true,
    ...patch
  };
}
