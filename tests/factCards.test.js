import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldBookEntryFromFact, normalizeFactCards } from '../server/agent/factCards.js';

test('normalizeFactCards preserves useful fields and fills management metadata', () => {
  const facts = normalizeFactCards([{
    title: '沈观澜获得名刀',
    content: '沈观澜获得名刀雪照。',
    keywords: ['沈观澜', '雪照'],
    type: 'item',
    extensions: { confidence: 'medium' }
  }], { now: '2026-06-29T00:00:00.000Z' });

  assert.equal(facts.length, 1);
  assert.match(facts[0].id, /^fact-/);
  assert.equal(facts[0].title, '沈观澜获得名刀');
  assert.equal(facts[0].content, '沈观澜获得名刀雪照。');
  assert.deepEqual(facts[0].keywords, ['沈观澜', '雪照']);
  assert.equal(facts[0].type, 'item');
  assert.equal(facts[0].enabled, true);
  assert.equal(facts[0].source, 'auto-extracted');
  assert.equal(facts[0].createdAt, '2026-06-29T00:00:00.000Z');
  assert.equal(facts[0].updatedAt, '2026-06-29T00:00:00.000Z');
  assert.deepEqual(facts[0].extensions, { confidence: 'medium' });
});

test('normalizeFactCards accepts legacy strings and skips empty facts', () => {
  const facts = normalizeFactCards(['镇武司旧案仍未查清。', { content: '   ' }], {
    now: '2026-06-29T00:00:00.000Z'
  });

  assert.equal(facts.length, 1);
  assert.equal(facts[0].title, '镇武司旧案仍未查清。');
  assert.equal(facts[0].content, '镇武司旧案仍未查清。');
  assert.deepEqual(facts[0].keywords, []);
});

test('normalizeFactCards validates type and preserves provided timestamps', () => {
  const longContent = '这是一段很长的事实内容用于测试默认标题截取到前四十个字符是否正确，不会超过四十。';
  const facts = normalizeFactCards([{
    content: longContent,
    type: 'unexpected',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z'
  }], { now: '2026-06-29T00:00:00.000Z' });

  assert.equal(facts.length, 1);
  assert.equal(facts[0].type, 'uncategorized');
  assert.equal(facts[0].title, longContent.slice(0, 40));
  assert.equal(facts[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(facts[0].updatedAt, '2026-02-02T00:00:00.000Z');
});

test('normalizeFactCards preserves supported rule facts from built-in content packs', () => {
  const [fact] = normalizeFactCards([{
    title: '叙事规则',
    content: '不得替主角决定核心行动。',
    type: 'rule'
  }], { now: '2026-06-29T00:00:00.000Z' });

  assert.equal(fact.type, 'rule');
});

test('createWorldBookEntryFromFact maps review facts into dynamic lore entries', () => {
  const entry = createWorldBookEntryFromFact({
    id: 'fact-sword',
    title: '名刀雪照',
    content: '沈观澜持有名刀雪照。',
    keywords: ['雪照'],
    type: 'item',
    enabled: false,
    extensions: { originTurnId: 'assistant-1' }
  }, { now: '2026-06-29T00:00:00.000Z' });

  assert.equal(entry.id, 'worldbook-fact-sword');
  assert.equal(entry.type, 'dynamic-memory');
  assert.equal(entry.title, '名刀雪照');
  assert.deepEqual(entry.keywords, ['雪照']);
  assert.equal(entry.content, '沈观澜持有名刀雪照。');
  assert.equal(entry.priority, 80);
  assert.equal(entry.depth, 6);
  assert.equal(entry.enabled, true);
  assert.deepEqual(entry.secondaryKeywords, []);
  assert.equal(entry.matchMode, 'keyword');
  assert.deepEqual(entry.regex, []);
  assert.equal(entry.logic, 'any');
  assert.equal(entry.insertionOrder, 0);
  assert.equal(entry.constant, false);
  assert.equal(entry.caseSensitive, false);
  assert.equal(entry.position, 'after_character');
  assert.equal(entry.scope, 'prompt');
  assert.equal(entry.source, 'fact-management');
  assert.equal(entry.updatedAt, '2026-06-29T00:00:00.000Z');
  assert.equal(entry.extensions.sourceFactId, 'fact-sword');
});
