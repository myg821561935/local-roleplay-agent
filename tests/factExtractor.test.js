import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFactExtractionPrompt } from '../server/agent/factExtractor.js';

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
