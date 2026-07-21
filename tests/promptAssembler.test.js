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
      extensions: {
        speech: '短句，少解释；遇到旧案时先试探对方知道多少。',
        knowledge: '知道镇武司公开职掌，不知道密档去向。'
      },
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
  assert.match(result.messages[0].content, /# 角色演绎契约/);
  assert.match(result.messages[0].content, /短句，少解释/);
  assert.match(result.messages[0].content, /不知道密档去向/);
  assert.match(result.messages[0].content, /只模仿风格特征，不逐句复述示例/);
  assert.match(result.messages[0].content, /# 沉浸式呈现契约/);
  assert.match(result.messages[0].content, /<special_status>/);
  assert.match(result.messages[0].content, /<recommended_actions>/);
  assert.ok(result.messages.some(m => /镇武司负责约束江湖武人/.test(m.content)));
  assert.match(result.messages[0].content, /云州城/);
  assert.match(result.messages[0].content, /主角刚到城中。/);
  assert.ok(result.messages.some((message) => message.content === '我走进云州城。'));
  assert.ok(result.messages.some((message) => message.content === '城门外风雪未歇。'));
  assert.deepEqual(result.sections.promptModules, ['core']);
  assert.equal(result.sections.hasCharacterCard, true);
});

test('assemblePrompt injects the persistent narrative route before story content', () => {
  const result = assemblePrompt({
    promptModules: [{ id: 'core', title: '核心', enabled: true, content: '保持仙侠。' }],
    characterCard: { name: '闻雪照', enabled: true },
    worldBook: [],
    memory: {
      worldState: {
        flags: { genre: 'xianxia' },
        quests: [{ title: '补全断魂灯并查清师门旧案', status: 'active' }]
      },
      ruleSystem: { contentPackId: 'xianxia', boundary: '只使用太虚仙侠规则。' },
      narrativeState: { activeArc: '补全断魂灯并查清师门旧案' },
      memoryCards: []
    },
    messages: [],
    userMessage: '我先去荒野寻找灯芯。',
    options: { narrativeMode: 'stable' }
  });

  assert.match(result.messages[0].content, /^# 叙事路线锁（稳定模式）/);
  assert.match(result.messages[0].content, /纯荒野探险取代修行和宗门\/家族主线/);
  assert.equal(result.sections.narrativeMode, 'stable');
  assert.equal(result.sections.narrativeGenre, 'xianxia');
  assert.equal(result.sections.narrativeArc, '补全断魂灯并查清师门旧案');
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

test('retrieveCards supports regex matching', () => {
  const result = retrieveCards({
    query: '沈观澜踏入第七层，听见刀鸣。',
    worldBook: [cardFixture({
      id: 'regex-card',
      title: '境界层数',
      matchMode: 'regex',
      regex: ['第[一二三四五六七八九十]+层'],
      keywords: [],
      content: '层数代表秘境深度。'
    })]
  });

  assert.deepEqual(result.map((card) => card.id), ['regex-card']);
});

test('retrieveCards supports mixed keyword and regex triggers', () => {
  const mixedCard = cardFixture({
    id: 'mixed-card',
    title: '武道境界',
    matchMode: 'keyword',
    keywords: ['境界', '突破'],
    regex: ['第[一二三四五六七八九十]+境'],
    content: '境界体系会影响战力判断。'
  });

  assert.deepEqual(
    retrieveCards({ query: '我想打听境界划分。', worldBook: [mixedCard] }).map((card) => card.id),
    ['mixed-card']
  );
  assert.deepEqual(
    retrieveCards({ query: '对方似乎已入第七境。', worldBook: [mixedCard] }).map((card) => card.id),
    ['mixed-card']
  );
});

test('retrieveCards supports selective secondary-key logic', () => {
  const selective = cardFixture({
    id: 'selective-card',
    title: '镇武司暗牢',
    keywords: ['镇武司'],
    secondaryKeywords: ['暗牢'],
    logic: 'selective'
  });

  assert.deepEqual(retrieveCards({ query: '我去镇武司门口。', worldBook: [selective] }), []);
  assert.deepEqual(
    retrieveCards({ query: '我去镇武司暗牢。', worldBook: [selective] }).map((card) => card.id),
    ['selective-card']
  );
});

test('retrieveCards always returns constant entries', () => {
  const result = retrieveCards({
    query: '无关文本',
    worldBook: [cardFixture({ id: 'constant-card', title: '常驻设定', keywords: [], constant: true })]
  });

  assert.deepEqual(result.map((card) => card.id), ['constant-card']);
});

test('retrieveCards logic=NOT triggers when keyword absent', () => {
  const card = cardFixture({
    id: 'not-card',
    title: '非战斗场景',
    keywords: ['战斗', '厮杀'],
    logic: 'not',
    content: '未发生战斗时触发。'
  });

  // 关键词未出现 → 触发
  assert.deepEqual(
    retrieveCards({ query: '我在茶馆喝茶。', worldBook: [card] }).map((c) => c.id),
    ['not-card']
  );
  // 关键词出现 → 不触发
  assert.deepEqual(retrieveCards({ query: '茶馆爆发了战斗。', worldBook: [card] }), []);
});

test('retrieveCards logic=NOT ALL triggers unless all keywords hit', () => {
  const card = cardFixture({
    id: 'not-all-card',
    title: '非完整组合',
    keywords: ['甲', '乙'],
    logic: 'not all',
    content: '未同时命中甲和乙时触发。'
  });

  // 仅命中甲 → 触发
  assert.deepEqual(
    retrieveCards({ query: '只有甲。', worldBook: [card] }).map((c) => c.id),
    ['not-all-card']
  );
  // 同时命中 → 不触发
  assert.deepEqual(retrieveCards({ query: '甲和乙都在。', worldBook: [card] }), []);
});

test('retrieveCards logic=ALL requires all keywords', () => {
  const card = cardFixture({
    id: 'all-card',
    title: '组合触发',
    keywords: ['甲', '乙'],
    logic: 'all',
    content: '需甲乙同时命中。'
  });

  assert.deepEqual(retrieveCards({ query: '只有甲。', worldBook: [card] }), []);
  assert.deepEqual(
    retrieveCards({ query: '甲和乙都在。', worldBook: [card] }).map((c) => c.id),
    ['all-card']
  );
});

test('retrieveCards regex mode with caseSensitive', () => {
  const card = cardFixture({
    id: 'case-regex',
    title: '英文大小写',
    matchMode: 'regex',
    regex: ['^[A-Z]'],
    caseSensitive: true,
    keywords: [],
    content: '以大写字母开头时触发。'
  });

  assert.deepEqual(
    retrieveCards({ query: 'Hello', worldBook: [card] }).map((c) => c.id),
    ['case-regex']
  );
  assert.deepEqual(retrieveCards({ query: 'hello', worldBook: [card] }), []);
});

test('retrieveCards invalid regex does not crash', () => {
  const card = cardFixture({
    id: 'bad-regex',
    title: '无效正则',
    matchMode: 'regex',
    regex: ['[未闭合'],
    keywords: [],
    content: '正则不合法时应安全跳过。'
  });

  assert.deepEqual(retrieveCards({ query: '任何文本', worldBook: [card] }), []);
});

test('assemblePrompt renders world book entries by insertion depth', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [
      cardFixture({ id: 'depth-2', title: '浅层伏笔', content: '两轮内要记得的伏笔。', depth: 2 }),
      cardFixture({ id: 'depth-6', title: '深层设定', content: '六轮内仍要保留的设定。', depth: 6 })
    ],
    memory: { worldState: {}, memoryCards: [] },
    messages: [],
    userMessage: '镇武司',
    options: { maxInjectedCards: 4 }
  });

  assert.ok(result.messages.some(m => /Depth 2/.test(m.content)));
  assert.ok(result.messages.some(m => /两轮内要记得的伏笔/.test(m.content)));
  assert.ok(result.messages.some(m => /Depth 6/.test(m.content)));
  assert.ok(result.messages.some(m => /六轮内仍要保留的设定/.test(m.content)));
});

test('assemblePrompt injects enabled normalized memory facts and ignores disabled facts', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [],
    memory: {
      worldState: {},
      memoryCards: [
        {
          id: 'fact-enabled',
          title: '名刀雪照',
          keywords: ['雪照'],
          content: '沈观澜持有名刀雪照。',
          enabled: true
        },
        {
          id: 'fact-disabled',
          title: '错误事实',
          keywords: ['雪照'],
          content: '这条禁用事实不应出现。',
          enabled: false
        },
        '雪照曾在镇武司旧案中出现。'
      ]
    },
    messages: [],
    userMessage: '我查看雪照刀身。',
    options: { maxInjectedCards: 5 }
  });

  assert.ok(result.messages.some(m => /沈观澜持有名刀雪照。/.test(m.content)));
  assert.ok(!result.messages.some(m => /雪照曾在镇武司旧案中出现。/.test(m.content)));
  assert.ok(!result.messages.some(m => /这条禁用事实不应出现。/.test(m.content)));
  assert.deepEqual(result.sections.injectedCardIds, ['fact-enabled']);
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
