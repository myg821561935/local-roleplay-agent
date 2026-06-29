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

  const creativeMode = state.promptModules.find((module) => module.id === 'personal-creative-mode');
  assert.ok(creativeMode);
  assert.match(creativeMode.content, /不增加限制词/);
  assert.ok(state.worldBook.find((entry) => entry.id === 'faction-zhenwusi'));
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

test('ConfigService falls back for invalid temperature string', async () => {
  const provider = await saveAndLoadProvider({ temperature: 'not-a-number' });

  assert.equal(provider.temperature, 0.9);
});

test('ConfigService falls back for invalid maxTokens string', async () => {
  const provider = await saveAndLoadProvider({ maxTokens: 'not-a-number' });

  assert.equal(provider.maxTokens, 2000);
});

test('ConfigService falls back for non-positive maxTokens', async () => {
  const zeroProvider = await saveAndLoadProvider({ maxTokens: 0 });
  const negativeProvider = await saveAndLoadProvider({ maxTokens: -10 });

  assert.equal(zeroProvider.maxTokens, 2000);
  assert.equal(negativeProvider.maxTokens, 2000);
});

async function saveAndLoadProvider(providerPatch) {
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
      headers: {},
      ...providerPatch
    }]
  });

  const state = await service.getAll();
  return state.providers.providers[0];
}
