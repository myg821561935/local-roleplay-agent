import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFactExtractionResult,
  buildFactExtractionPrompt,
  normalizeDynamicWorldBookEntries,
  parseFactExtractionResult
} from '../server/agent/factExtractor.js';

test('buildFactExtractionPrompt tells the model to emit dynamic world book entries', () => {
  const prompt = buildFactExtractionPrompt({
    worldState: { protagonist: { name: '沈观澜' } },
    messages: [{ role: 'user', content: '我拔出雪照。' }]
  });
  const systemPrompt = prompt[0].content;

  assert.match(systemPrompt, /worldBook/);
  assert.match(systemPrompt, /keywords/);
  assert.match(systemPrompt, /depth/);
  assert.match(systemPrompt, /动态世界书/);
});

test('buildFactExtractionPrompt includes route and institutional ledgers', () => {
  const prompt = buildFactExtractionPrompt({
    worldState: { flags: { genre: 'xianxia' } },
    messages: [{ role: 'user', content: '我借用族中灵田修行三月。' }],
    narrativeContext: {
      mode: 'stable',
      genre: 'xianxia',
      label: '太虚仙侠',
      activeArc: '清虚宗旧案',
      pillars: ['修行道途', '代际传承'],
      supporting: ['秘境探索']
    }
  });
  const systemPrompt = prompt[0].content;

  assert.match(systemPrompt, /叙事路线门禁/);
  assert.match(systemPrompt, /清虚宗旧案/);
  assert.match(systemPrompt, /resourceLedger/);
  assert.match(systemPrompt, /institutionLedger/);
});

test('parseFactExtractionResult returns empty object for non-JSON content', () => {
  const result = parseFactExtractionResult('抱歉，我无法提取事实。');
  assert.deepEqual(result, {});
});

test('parseFactExtractionResult extracts first JSON object from mixed text', () => {
  const result = parseFactExtractionResult('好的，这是结果：\n{"worldState":{"protagonist":{"name":"沈观澜"}}}\n以上是事实。');
  assert.equal(result.worldState.protagonist.name, '沈观澜');
});

test('parseFactExtractionResult handles fenced JSON with surrounding prose', () => {
  const result = parseFactExtractionResult('```json\n{"memoryCards":[]}\n```\n解释文字。');
  assert.deepEqual(result.memoryCards, []);
});

test('applyFactExtractionResult tolerates non-JSON model output without throwing', () => {
  const memory = {
    rollingSummary: '',
    unsummarizedTurnCount: 1,
    worldState: { protagonist: { name: '原主角' } },
    memoryCards: [],
    eventLedger: []
  };
  const next = applyFactExtractionResult(memory, '我无法理解，请重新提问。');
  assert.equal(next.worldState.protagonist.name, '原主角');
  assert.equal(next.lastFactExtractionError, '');
});

test('normalizeDynamicWorldBookEntries returns empty array for non-JSON content', () => {
  const entries = normalizeDynamicWorldBookEntries('这不是 JSON。');
  assert.deepEqual(entries, []);
});

test('stable route keeps unconfirmed extracted facts disabled for creator review', () => {
  const memory = {
    worldState: { flags: { genre: 'xianxia' } },
    memoryCards: []
  };
  const content = JSON.stringify({
    memoryCards: [{
      title: '荒野藏宝图',
      content: '模型临时提出了一张藏宝图。',
      extensions: {
        stability: 'candidate',
        genre: 'xianxia',
        narrativeRole: 'supporting',
        returnsToPillar: '回流宗门资源争议'
      }
    }]
  });
  const next = applyFactExtractionResult(memory, content, {
    narrativeContext: { mode: 'stable', genre: 'xianxia' }
  });

  assert.equal(next.memoryCards[0].enabled, false);
  assert.equal(next.memoryCards[0].extensions.reviewStatus, 'candidate');
});

test('stable route admits confirmed supporting facts only when they return to a pillar', () => {
  const content = JSON.stringify({
    memoryCards: [{
      title: '秘境名额质押',
      content: '用户确认用落雷秘境名额换取旧卷宗。',
      extensions: {
        stability: 'confirmed',
        genre: 'xianxia',
        narrativeRole: 'supporting',
        returnsToPillar: '推进清虚宗旧案与资源权属'
      }
    }]
  });
  const next = applyFactExtractionResult({ worldState: {}, memoryCards: [] }, content, {
    narrativeContext: { mode: 'stable', genre: 'xianxia' }
  });

  assert.equal(next.memoryCards[0].enabled, true);
  assert.equal(next.memoryCards[0].extensions.reviewStatus, 'admitted');
});

test('stable route rejects drift world-book entries and preserves the locked genre', () => {
  const context = { mode: 'stable', genre: 'xianxia' };
  const content = JSON.stringify({
    worldState: { flags: { genre: 'wilderness-survival', weather: '暴雨' } },
    worldBook: [
      {
        title: '纯荒野求生规则',
        content: '从此只计算饥饿和庇护所。',
        extensions: { stability: 'confirmed', genre: 'xianxia', narrativeRole: 'drift' }
      },
      {
        title: '落雷秘境所得归属',
        content: '秘境所得要按宗门贡献契约分配。',
        extensions: { stability: 'confirmed', genre: 'xianxia', narrativeRole: 'core' }
      }
    ]
  });
  const next = applyFactExtractionResult({
    worldState: { flags: { genre: 'xianxia' } },
    memoryCards: []
  }, content, { narrativeContext: context });
  const entries = normalizeDynamicWorldBookEntries(content, { narrativeContext: context });

  assert.equal(next.worldState.flags.genre, 'xianxia');
  assert.equal(next.worldState.flags.weather, '暴雨');
  assert.deepEqual(entries.map((entry) => entry.title), ['落雷秘境所得归属']);
});
