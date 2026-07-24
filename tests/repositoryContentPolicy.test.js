import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findLocalOnlyTrackedPaths,
  LOCAL_ONLY_PREFIXES
} from '../scripts/check-public-repository.mjs';

test('repository policy blocks local configuration and imported community assets', () => {
  const violations = findLocalOnlyTrackedPaths([
    'server/app.js',
    'data/config/character-card.json',
    'data/library/resources/community-card.json',
    'data/assets/character-images/portrait.png',
    'data/content-packs-local/private-pack/worldbook.json',
    'tests/resourceEvaluator.test.js'
  ]);

  assert.deepEqual(violations, [
    'data/assets/character-images/portrait.png',
    'data/config/character-card.json',
    'data/content-packs-local/private-pack/worldbook.json',
    'data/library/resources/community-card.json'
  ]);
});

test('repository policy permits framework files and reviewed built-in demos', () => {
  const violations = findLocalOnlyTrackedPaths([
    'public/app.js',
    'server/config/defaults.js',
    'docs/content-pack-spec-v1.md',
    'data/content-packs/yingxiongzhi/README.md',
    'public/assets/xianxia-stage.png'
  ]);

  assert.deepEqual(violations, []);
  assert.ok(LOCAL_ONLY_PREFIXES.includes('data/config/'));
});
