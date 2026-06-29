import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';

test('AgentService runs one chat turn and records memory metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-loop-'));
  const store = new JsonStore(root);
  const configService = new ConfigService(store);
  await configService.saveProviders({
    activeProviderId: 'fake',
    providers: [{
      id: 'fake',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'fake-model',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {}
    }]
  });

  const providerClient = {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };

  const service = new AgentService({
    configService,
    sessionService: new SessionService(store),
    providerClient
  });

  const result = await service.sendMessage({ sessionId: 'main', content: '我去镇武司。' });
  assert.equal(result.session.messages.length, 2);
  assert.equal(result.session.memory.eventLedger.length, 1);
  assert.equal(result.debug.injectedCards.length, 1);
});
