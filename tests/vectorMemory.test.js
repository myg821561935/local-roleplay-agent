import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VectorStore } from '../server/agent/vectorStore.js';

test('VectorStore.add and search returns top-K by cosine similarity', () => {
  const store = new VectorStore();
  store.add('a', [1, 0, 0], { label: 'a' });
  store.add('b', [0, 1, 0], { label: 'b' });
  store.add('c', [1, 1, 0], { label: 'c' });

  const results = store.search([1, 0.1, 0], 2);
  assert.equal(results.length, 2);
  // c 与 query 最相似（都包含 x 分量且非正交）
  assert.equal(results[0].id, 'a');
  assert.ok(results[0].score > results[1].score);
});

test('VectorStore.add with same id overwrites', () => {
  const store = new VectorStore();
  store.add('a', [1, 0, 0]);
  store.add('a', [0, 1, 0]);
  assert.equal(store.size, 1);
  const results = store.search([0, 1, 0], 1);
  assert.equal(results[0].id, 'a');
  assert.ok(results[0].score > 0.99);
});

test('VectorStore.search with filter excludes records', () => {
  const store = new VectorStore();
  store.add('a', [1, 0, 0], { role: 'user' });
  store.add('b', [1, 0, 0], { role: 'assistant' });
  const results = store.search([1, 0, 0], 5, (m) => m.role === 'assistant');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'b');
});

test('VectorStore.remove deletes by id', () => {
  const store = new VectorStore();
  store.add('a', [1, 0, 0]);
  store.add('b', [0, 1, 0]);
  store.remove('a');
  assert.equal(store.size, 1);
  assert.ok(!store.has('a'));
});

test('VectorStore.search returns empty for zero query norm', () => {
  const store = new VectorStore();
  store.add('a', [1, 0, 0]);
  assert.deepEqual(store.search([0, 0, 0], 5), []);
});

test('VectorStore.search handles dimension mismatch safely', () => {
  const store = new VectorStore();
  store.add('a', [1, 0, 0]);
  const results = store.search([1, 0, 0, 0], 5);
  assert.deepEqual(results, []);
});

test('VectorStore.loadFromJSON restores records', () => {
  const store = new VectorStore();
  store.loadFromJSON([
    { id: 'a', vector: [1, 0], metadata: {} },
    { id: 'b', vector: [0, 1], metadata: {} }
  ]);
  assert.equal(store.size, 2);
  const results = store.search([1, 0], 1);
  assert.equal(results[0].id, 'a');
});

test('buildEmbeddingText truncates long content', async () => {
  const { buildEmbeddingText } = await import('../server/agent/embeddingClient.js');
  const long = 'x'.repeat(2000);
  const text = buildEmbeddingText({ role: 'user', content: long });
  assert.ok(text.length < 1100);
  assert.ok(text.startsWith('[user]'));
});

test('embed throws on missing baseUrl', async () => {
  const { embed } = await import('../server/agent/embeddingClient.js');
  await assert.rejects(
    embed({ provider: { apiKey: 'k', model: 'm' }, fetchImpl: async () => ({}), input: 'test' }),
    /baseUrl/
  );
});

test('embed parses OpenAI-compatible response', async () => {
  const { embed } = await import('../server/agent/embeddingClient.js');
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] }
      ]
    })
  });
  const { vectors } = await embed({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    input: ['a', 'b'],
    fetchImpl: fakeFetch
  });
  assert.equal(vectors.length, 2);
  assert.deepEqual(vectors[0], [0.1, 0.2, 0.3]);
});

test('resolveEmbeddingProvider prefers vectorMemory.providerId', async () => {
  const { resolveEmbeddingProvider } = await import('../server/agent/vectorMemory.js');
  const provider = resolveEmbeddingProvider({
    providers: {
      activeProviderId: 'chat',
      providers: [
        { id: 'chat', kind: 'openai-compatible' },
        { id: 'embed', kind: 'openai-compatible' }
      ]
    },
    vectorMemory: { providerId: 'embed' }
  });
  assert.equal(provider.id, 'embed');
});

test('VectorMemoryService.indexMessages skips when no provider configured', async () => {
  const { VectorMemoryService } = await import('../server/agent/vectorMemory.js');
  const service = new VectorMemoryService({
    configService: { getAll: async () => ({ providers: { providers: [] } }) },
    fetchImpl: async () => ({})
  });
  const result = await service.indexMessages({
    sessionId: 's1',
    messages: [{ id: 'm1', role: 'user', content: 'hi' }]
  });
  assert.equal(result.indexed, 0);
  assert.equal(result.error, 'NO_EMBEDDING_PROVIDER');
});

test('VectorMemoryService.indexMessages and search returns matching messages', async () => {
  const { VectorMemoryService } = await import('../server/agent/vectorMemory.js');
  // 简单 embedding：把输入字符串映射到固定向量
  // 'hello world' 系列 -> [1, 0, 0]
  // 'goodbye' 系列 -> [0, 1, 0]
  // 'how are you' 系列 -> [1, 1, 0]
  // 其他 -> [0, 0, 1]
  function fakeEmbed(text) {
    if (/hello/i.test(text)) return [1, 0, 0];
    if (/goodbye/i.test(text)) return [0, 1, 0];
    if (/how are/i.test(text)) return [1, 1, 0];
    return [0, 0, 1];
  }
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: inputs.map((input, i) => ({ index: i, embedding: fakeEmbed(input) }))
      })
    };
  };

  const config = {
    providers: {
      activeProviderId: 'p1',
      providers: [{ id: 'p1', kind: 'openai-compatible', baseUrl: 'http://x', apiKey: 'k', model: 'm' }]
    }
  };
  const service = new VectorMemoryService({
    configService: { getAll: async () => config },
    fetchImpl: fakeFetch
  });

  const result = await service.indexMessages({
    sessionId: 's1',
    messages: [
      { id: 'm1', role: 'user', content: 'hello world' },
      { id: 'm2', role: 'assistant', content: 'goodbye' },
      { id: 'm3', role: 'user', content: 'how are you' }
    ]
  });
  assert.equal(result.indexed, 3);

  const results = await service.search({ sessionId: 's1', query: 'hello world', topK: 2 });
  assert.ok(results.length > 0);
  assert.equal(results[0].messageId, 'm1');
});

test('VectorMemoryService.search returns empty when index missing', async () => {
  const { VectorMemoryService } = await import('../server/agent/vectorMemory.js');
  const service = new VectorMemoryService({
    configService: { getAll: async () => ({ providers: { providers: [] } }) },
    fetchImpl: async () => ({})
  });
  const results = await service.search({ sessionId: 'unknown', query: 'test' });
  assert.deepEqual(results, []);
});

test('VectorMemoryService.removeMessage drops message from index', async () => {
  const { VectorMemoryService } = await import('../server/agent/vectorMemory.js');
  const fakeFetch = async (url, opts) => ({
    ok: true,
    text: async () => {
      const body = JSON.parse(opts.body);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return JSON.stringify({
        data: inputs.map((_, i) => ({ index: i, embedding: [1, 0, 0] }))
      });
    }
  });
  const config = {
    providers: {
      activeProviderId: 'p1',
      providers: [{ id: 'p1', kind: 'openai-compatible', baseUrl: 'http://x', apiKey: 'k', model: 'm' }]
    }
  };
  const service = new VectorMemoryService({
    configService: { getAll: async () => config },
    fetchImpl: fakeFetch
  });
  await service.indexMessages({
    sessionId: 's1',
    messages: [{ id: 'm1', role: 'user', content: 'hello' }]
  });
  assert.equal(service.getStats('s1').indexed, 1);
  service.removeMessage('s1', 'm1');
  assert.equal(service.getStats('s1').indexed, 0);
});
