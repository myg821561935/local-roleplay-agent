import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';

test('ConfigService returns seeded prompt modules and world book', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  const state = await service.getAll();
  assert.equal(state.promptModules.length >= 5, true);
  assert.equal(state.worldBook.length >= 3, true);
  assert.equal(state.providers.activeProviderId, '');
});

test('ConfigService saves provider config without touching prompt modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  await service.saveProviders({
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {}
    }]
  });
  const state = await service.getAll();
  assert.equal(state.providers.activeProviderId, 'local');
  assert.equal(state.promptModules.length >= 5, true);
});
