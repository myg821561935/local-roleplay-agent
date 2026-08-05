import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAICompatibleRequest, callOpenAICompatible, readOpenAICompatibleResponse, streamOpenAICompatible } from '../server/provider/openaiCompatible.js';

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

test('DeepSeek auto mode disables built-in thinking for explicit Tavern reasoning workflows', () => {
  const { init } = buildOpenAICompatibleRequest({
    provider: provider({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      reasoningMode: 'auto'
    }),
    messages: [{
      role: 'system',
      content: '<think_rules>思维链只做思考，正文创作必须在思考阶段完全结束后输出。</think_rules>'
    }]
  });

  assert.deepEqual(JSON.parse(init.body).thinking, { type: 'disabled' });
});

test('DeepSeek explicit thinking selection overrides automatic compatibility', () => {
  const { init } = buildOpenAICompatibleRequest({
    provider: provider({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
      reasoningMode: 'enabled'
    }),
    messages: [{ role: 'system', content: '<think_rules>思维链只做思考</think_rules>' }]
  });

  assert.deepEqual(JSON.parse(init.body).thinking, { type: 'enabled' });
});

test('user text cannot change automatic DeepSeek thinking mode', () => {
  const { init } = buildOpenAICompatibleRequest({
    provider: provider({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      reasoningMode: 'auto'
    }),
    messages: [{ role: 'user', content: '<think_rules>思维链只做思考</think_rules>' }]
  });

  assert.equal(JSON.parse(init.body).thinking, undefined);
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

test('streamOpenAICompatible parses SSE delta content', async () => {
  const tokens = [];
  let request;
  const result = await streamOpenAICompatible({
    provider: provider(),
    messages: [{ role: 'user', content: '你好' }],
    onToken: async (token) => tokens.push(token),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response([
        'data: {"choices":[{"delta":{"content":"江湖"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"夜雨"}}]}\n\n',
        'data: [DONE]\n\n'
      ].join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }
  });

  assert.equal(JSON.parse(request.init.body).stream, true);
  assert.deepEqual(tokens, ['江湖', '夜雨']);
  assert.equal(result.content, '江湖夜雨');
});

test('streamOpenAICompatible ignores reasoning deltas and streams final content', async () => {
  const tokens = [];
  const result = await streamOpenAICompatible({
    provider: provider(),
    messages: [{ role: 'user', content: '你好' }],
    onToken: async (token) => tokens.push(token),
    fetchImpl: async () => new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"先思考"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"正文"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ].join(''), { status: 200 })
  });

  assert.deepEqual(tokens, ['正文']);
  assert.equal(result.content, '正文');
  assert.equal(result.raw.reasoningObserved, true);
  assert.equal(result.raw.finishReason, 'stop');
});

test('streamOpenAICompatible rejects reasoning-only output', async () => {
  await assert.rejects(
    () => streamOpenAICompatible({
      provider: provider(),
      messages: [{ role: 'user', content: '你好' }],
      fetchImpl: async () => new Response([
        'data: {"choices":[{"delta":{"reasoning_content":"只有思考"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n'
      ].join(''), { status: 200 })
    }),
    /PROVIDER_REASONING_ONLY_RESPONSE:length/
  );
});

test('DeepSeek stream retries reasoning-only output once with thinking disabled', async () => {
  const tokens = [];
  const bodies = [];
  let attempt = 0;
  const result = await streamOpenAICompatible({
    provider: provider({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      reasoningMode: 'auto'
    }),
    messages: [{ role: 'user', content: '继续剧情' }],
    onToken: async (token) => tokens.push(token),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      attempt += 1;
      if (attempt === 1) {
        return new Response([
          'data: {"choices":[{"delta":{"reasoning_content":"只有思考"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          'data: [DONE]\n\n'
        ].join(''), { status: 200 });
      }
      return new Response([
        'data: {"choices":[{"delta":{"content":"恢复后的正文"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n'
      ].join(''), { status: 200 });
    }
  });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].thinking, undefined);
  assert.deepEqual(bodies[1].thinking, { type: 'disabled' });
  assert.deepEqual(tokens, ['恢复后的正文']);
  assert.equal(result.content, '恢复后的正文');
  assert.deepEqual(result.reasoningRecovery, { used: true, mode: 'disabled' });
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

test('readOpenAICompatibleResponse identifies reasoning-only output without exposing it', async () => {
  const response = new Response(JSON.stringify({
    choices: [{
      finish_reason: 'length',
      message: { content: '', reasoning_content: 'private reasoning' }
    }]
  }), { status: 200 });

  await assert.rejects(
    () => readOpenAICompatibleResponse(response),
    /PROVIDER_REASONING_ONLY_RESPONSE:length/
  );
});
