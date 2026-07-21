import test from 'node:test';
import assert from 'node:assert/strict';

import { testProviderConnection } from '../server/services/providerTestService.js';

test('provider connection test reserves enough output for reasoning models', async () => {
  let request;
  const result = await testProviderConnection({
    provider: {
      id: 'glm-test',
      kind: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'glm-5.2',
      maxTokens: 4096
    },
    providerClient: {
      async complete(payload) {
        request = payload;
        return { content: 'OK' };
      }
    },
    fetchImpl: async () => {
      throw new Error('fetch should be delegated through providerClient');
    }
  });

  assert.equal(request.provider.maxTokens, 256);
  assert.equal(request.provider.temperature, 0);
  assert.match(request.messages[0].content, /exactly OK/);
  assert.equal(result.ok, true);
  assert.equal(result.responsePreview, 'OK');
});

test('provider connection test raises tiny or invalid limits to a safe minimum', async () => {
  const observed = [];
  const providerClient = {
    async complete({ provider }) {
      observed.push(provider.maxTokens);
      return { content: 'OK' };
    }
  };

  await testProviderConnection({
    provider: { id: 'tiny', model: 'glm-5.2', maxTokens: 8 },
    providerClient
  });
  await testProviderConnection({
    provider: { id: 'invalid', model: 'glm-5.2', maxTokens: 'invalid' },
    providerClient
  });

  assert.deepEqual(observed, [128, 128]);
});
