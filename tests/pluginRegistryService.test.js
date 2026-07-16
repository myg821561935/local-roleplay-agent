import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { PluginRegistryService } from '../server/services/pluginRegistryService.js';

test('plugin registry exposes compatible built-in adapters', async () => {
  const service = await createService();
  const plugins = await service.listPlugins();
  const adapters = await service.listAdapters();

  assert.ok(plugins.find((item) => item.id === 'core.content-pack-v1' && item.compatible));
  assert.ok(adapters.find((item) => item.id === 'character-card-v2'));
  assert.ok(adapters.find((item) => item.id === 'lra-plugin-manifest-v1'));
});

test('plugin registry installs declarative adapters and blocks executable fields', async () => {
  const service = await createService();
  const manifest = createPluginManifest();
  const result = await service.installManifest(manifest);

  assert.equal(result.installStatus, 'created');
  assert.equal(result.plugin.origin, 'local');
  assert.ok((await service.listAdapters()).find((item) => item.id === 'rain-night-lore'));

  const blocked = await service.inspectManifest({ ...manifest, id: 'community.unsafe', script: 'run-me.js' });
  assert.equal(blocked.canInstall, false);
  assert.ok(blocked.blockingIssues.find((item) => item.code === 'executable-plugin-unsupported'));
});

test('plugin registry prevents silent downgrade and allows removal of local plugins', async () => {
  const service = await createService();
  await service.installManifest({ ...createPluginManifest(), version: '1.2.0' });
  const downgrade = await service.inspectManifest({ ...createPluginManifest(), version: '1.1.0' });

  assert.equal(downgrade.canInstall, false);
  assert.equal(downgrade.installAction, 'downgrade');
  assert.equal(await service.removePlugin('community.rain-night'), true);
  assert.equal((await service.listPlugins()).some((item) => item.id === 'community.rain-night'), false);
});

async function createService() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'plugin-registry-'));
  return new PluginRegistryService(new JsonStore(rootDir), {
    appVersion: '0.2.2',
    now: () => new Date('2026-07-15T08:00:00.000Z')
  });
}

function createPluginManifest() {
  return {
    spec: 'lra.plugin/v1',
    id: 'community.rain-night',
    version: '1.0.0',
    name: '雨夜世界书适配',
    engine: '>=0.2.2 <1.0.0',
    adapters: [{
      id: 'rain-night-lore',
      label: '雨夜世界书',
      kinds: ['worldbook'],
      formats: ['json'],
      priority: 130,
      match: { previewKinds: ['world-book'], sourceIncludes: ['rain-night'] }
    }]
  };
}
