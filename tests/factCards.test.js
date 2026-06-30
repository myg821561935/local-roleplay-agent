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

test('createWorldBookEntryFromFact maps review facts into dynamic lore entries', () => {
  const entry = createWorldBookEntryFromFact({
    id: 'fact-sword',
    title: '名刀雪照',
    content: '沈观澜持有名刀雪照。',
    keywords: ['雪照'],
    type: 'item',
    enabled: true,
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
  assert.equal(entry.source, 'fact-management');
  assert.equal(entry.updatedAt, '2026-06-29T00:00:00.000Z');
  assert.equal(entry.extensions.sourceFactId, 'fact-sword');
});
