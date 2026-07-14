import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnthropicRequest } from '../server/provider/anthropic.js';
import { buildGeminiRequest } from '../server/provider/gemini.js';
import { buildProviderClient } from '../server/provider/providerRegistry.js';

test('buildAnthropicRequest maps system and chat messages to Messages API', () => {
  const { url, init } = buildAnthropicRequest({
    provider: {
      apiKey: 'secret',
      model: 'claude-3-5-sonnet-latest',
      temperature: 0.7,
      maxTokens: 1200
    },
    messages: [
      { role: 'system', content: '保持武侠叙事。' },
      { role: 'user', content: '我推门进去。' },
      { role: 'assistant', content: '门后风雪扑面。' }
    ]
  });
  const body = JSON.parse(init.body);

  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'secret');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.model, 'claude-3-5-sonnet-latest');
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.system, '保持武侠叙事。');
  assert.deepEqual(body.messages, [
    { role: 'user', content: '我推门进去。' },
    { role: 'assistant', content: '门后风雪扑面。' }
  ]);
});

test('buildGeminiRequest maps chat messages to generateContent request', () => {
  const { url, init } = buildGeminiRequest({
    provider: {
      apiKey: 'secret',
      model: 'gemini-2.5-flash',
      temperature: 0.8,
      maxTokens: 2048
    },
    messages: [
      { role: 'system', content: '保持武侠叙事。' },
      { role: 'user', content: '我推门进去。' },
      { role: 'assistant', content: '门后风雪扑面。' }
    ]
  });
  const body = JSON.parse(init.body);

  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=secret');
  assert.equal(body.systemInstruction.parts[0].text, '保持武侠叙事。');
  assert.deepEqual(body.contents, [
    { role: 'user', parts: [{ text: '我推门进去。' }] },
    { role: 'model', parts: [{ text: '门后风雪扑面。' }] }
  ]);
  assert.equal(body.generationConfig.maxOutputTokens, 2048);
});

test('buildProviderClient routes anthropic provider and reads response content', async () => {
  const client = buildProviderClient();
  let request;
  const result = await client.complete({
    provider: {
      kind: 'anthropic',
      apiKey: 'secret',
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 500
    },
    messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '你好' }],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '江湖夜雨。' }]
      }), { status: 200 });
    }
  });

  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(result.content, '江湖夜雨。');
});

test('buildProviderClient routes gemini provider and reads response content', async () => {
  const client = buildProviderClient();
  let request;
  const result = await client.complete({
    provider: {
      kind: 'gemini',
      apiKey: 'secret',
      model: 'gemini-2.5-flash',
      maxTokens: 500
    },
    messages: [{ role: 'user', content: '你好' }],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '江湖夜雨。' }] } }]
      }), { status: 200 });
    }
  });

  assert.match(request.url, /gemini-2\.5-flash:generateContent/);
  assert.equal(result.content, '江湖夜雨。');
});
