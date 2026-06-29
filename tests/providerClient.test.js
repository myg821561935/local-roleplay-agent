import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAICompatibleRequest, callOpenAICompatible, readOpenAICompatibleResponse } from '../server/provider/openaiCompatible.js';

function provider(overrides = {}) {
  return {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'model-a',
    temperature: 0.8,
    maxTokens: 1234,
    ...overrides
  };
}

test('buildOpenAICompatibleRequest builds chat completions request', () => {
  const { url, init } = buildOpenAICompatibleRequest({
    provider: {
      ...provider(),
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

test('buildOpenAICompatibleRequest ignores reserved custom headers', () => {
  const { init } = buildOpenAICompatibleRequest({
    provider: provider({
      headers: {
        Authorization: 'Bearer wrong',
        'Content-Type': 'text/plain',
        'x-test': 'yes'
      }
    }),
    messages: [{ role: 'user', content: '你好' }]
  });

  assert.equal(init.headers.authorization, 'Bearer secret');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.equal(init.headers['x-test'], 'yes');
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.headers['Content-Type'], undefined);
});

test('buildOpenAICompatibleRequest requires provider object', () => {
  assert.throws(
    () => buildOpenAICompatibleRequest({
      provider: null,
      messages: []
    }),
    /provider must be an object/
  );
});

test('buildOpenAICompatibleRequest requires baseUrl', () => {
  assert.throws(
    () => buildOpenAICompatibleRequest({
      provider: provider({ baseUrl: ' ' }),
      messages: []
    }),
    /Provider baseUrl is required/
  );
});

test('buildOpenAICompatibleRequest requires model', () => {
  assert.throws(
    () => buildOpenAICompatibleRequest({
      provider: provider({ model: '' }),
      messages: []
    }),
    /Provider model is required/
  );
});

test('buildOpenAICompatibleRequest requires apiKey', () => {
  assert.throws(
    () => buildOpenAICompatibleRequest({
      provider: provider({ apiKey: '' }),
      messages: []
    }),
    /Provider apiKey is required/
  );
});

test('buildOpenAICompatibleRequest requires messages array', () => {
  assert.throws(
    () => buildOpenAICompatibleRequest({
      provider: provider(),
      messages: null
    }),
    /messages must be an array/
  );
});

test('callOpenAICompatible uses injected fetch and extracts content', async () => {
  let request;
  const result = await callOpenAICompatible({
    provider: provider(),
    messages: [{ role: 'user', content: '你好' }],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '收到。' } }]
      }), { status: 200 });
    }
  });

  assert.equal(request.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(request.init.method, 'POST');
  assert.equal(JSON.parse(request.init.body).messages[0].content, '你好');
  assert.equal(result.content, '收到。');
});

test('readOpenAICompatibleResponse extracts assistant content', async () => {
  const response = new Response(JSON.stringify({
    choices: [{ message: { content: '江湖夜雨。' } }]
  }), { status: 200 });

  const result = await readOpenAICompatibleResponse(response);
  assert.equal(result.content, '江湖夜雨。');
});

test('readOpenAICompatibleResponse throws for non-JSON response with status', async () => {
  const response = new Response('gateway down', { status: 502 });

  await assert.rejects(
    () => readOpenAICompatibleResponse(response),
    /Provider returned non-JSON response 502: gateway down/
  );
});

test('readOpenAICompatibleResponse throws for non-ok JSON response', async () => {
  const response = new Response(JSON.stringify({
    error: { message: 'bad key' }
  }), { status: 401 });

  await assert.rejects(
    () => readOpenAICompatibleResponse(response),
    /Provider error 401:/
  );
});

test('readOpenAICompatibleResponse throws for missing assistant content', async () => {
  const response = new Response(JSON.stringify({
    choices: [{ message: {} }]
  }), { status: 200 });

  await assert.rejects(
    () => readOpenAICompatibleResponse(response),
    /Provider response missing assistant content:/
  );
});
