import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAICompatibleRequest, readOpenAICompatibleResponse } from '../server/provider/openaiCompatible.js';

test('buildOpenAICompatibleRequest builds chat completions request', () => {
  const { url, init } = buildOpenAICompatibleRequest({
    provider: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1234,
      headers: { 'x-test': 'yes' }
    },
    messages: [{ role: 'user', content: '你好' }]
  });

  assert.equal(url, 'https://api.example.com/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer secret');
  assert.equal(init.headers['x-test'], 'yes');
  assert.equal(JSON.parse(init.body).model, 'model-a');
});

test('readOpenAICompatibleResponse extracts assistant content', async () => {
  const response = new Response(JSON.stringify({
    choices: [{ message: { content: '江湖夜雨。' } }]
  }), { status: 200 });

  const result = await readOpenAICompatibleResponse(response);
  assert.equal(result.content, '江湖夜雨。');
});
