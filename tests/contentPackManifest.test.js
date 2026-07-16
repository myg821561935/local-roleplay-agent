import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contentPackFromBundle,
  createContentPackBundle,
  inspectContentPackBundle,
  isContentPackBundle
} from '../server/content/contentPackManifest.js';

test('content pack v1 bundle is self-contained and preserves story systems', () => {
  const bundle = createContentPackBundle(createPack());
  const restored = contentPackFromBundle(bundle, 'custom-imported-rain-night');

  assert.equal(isContentPackBundle(bundle), true);
  assert.equal(bundle.manifest.version, '1.0.0');
  assert.equal(restored.characterCard.name, '沈观澜');
  assert.equal(restored.worldBook.length, 1);
  assert.equal(restored.ruleSystem.id, 'rain-night-rules');
  assert.ok(bundle.manifest.capabilities.includes('world-simulation'));
});

test('content pack compatibility blocks missing runtime dependencies', () => {
  const bundle = createContentPackBundle(createPack(), {
    dependencies: [{ kind: 'plugin', id: 'community.missing', range: '^1.0.0', scope: 'runtime' }]
  });
  const inspection = inspectContentPackBundle(bundle, { appVersion: '0.2.2' });

  assert.equal(inspection.canInstall, false);
  assert.ok(inspection.blockingIssues.find((item) => item.code === 'content-pack-dependency-missing'));
});

test('content pack build dependencies are review warnings rather than runtime blockers', () => {
  const bundle = createContentPackBundle(createPack(), {
    dependencies: [{ kind: 'content-pack', id: 'xianxia', range: '^1.0.0', scope: 'build' }]
  });
  const inspection = inspectContentPackBundle(bundle, { appVersion: '0.2.2' });

  assert.equal(inspection.canInstall, true);
  assert.equal(inspection.verdict, 'review');
});

function createPack() {
  return {
    id: 'rain-night-xianxia',
    title: '听雨仙途',
    description: '雨夜旧案与仙门因果。',
    sessionTitle: '听雨楼夜话',
    visualPackId: 'xianxia',
    characterCard: { name: '沈观澜', description: '负刀问道。' },
    characterPresets: [{
      id: 'rain-night-keeper',
      characterCard: {
        name: '守夜人',
        extensions: {
          npcCard: true,
          privateKnowledge: ['知道雨夜旧案的第二份口供'],
          schedule: [{ at: '23:00', location: '听雨楼', activity: '核对旧账', visibility: 'private' }]
        }
      }
    }],
    worldBook: [{ id: 'rain-lore', title: '听雨楼', keywords: ['听雨楼'], content: '听雨楼不问来路。' }],
    promptModules: [{ id: 'rain-prompt', title: '雨夜文风', content: '克制叙事。', enabled: true }],
    memory: { memoryCards: [] },
    ruleSystem: { id: 'rain-night-rules', title: '听雨规则', boundary: '仙侠悬案', panels: [] }
  };
}
