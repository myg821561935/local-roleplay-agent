import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY_IMPORT_MODES,
  evaluateStoryImportRoute
} from '../public/modules/importRouting.js';

test('matching community resource is recommended for the selected baseline', () => {
  const route = evaluateStoryImportRoute({
    kind: 'character-card',
    summary: { declaredContentPacks: ['xianxia'], declaredGenre: '仙侠' }
  }, { basePackId: 'xianxia', basePackTitle: '太虚仙侠' });

  assert.equal(route.recommendedMode, STORY_IMPORT_MODES.ATTACH);
  assert.equal(route.compatibility, 'compatible');
  assert.equal(route.canAttach, true);
});

test('genre mismatch recommends an independent copy but still allows manual attachment', () => {
  const route = evaluateStoryImportRoute({
    kind: 'character-card',
    summary: { tags: ['仙侠', '宗门'] }
  }, { basePackId: 'lingyi', basePackTitle: '民俗灵异' });

  assert.equal(route.recommendedMode, STORY_IMPORT_MODES.INDEPENDENT);
  assert.equal(route.compatibility, 'mismatch');
  assert.equal(route.canAttach, true);
  assert.match(route.reason, /民俗灵异/);
});

test('self-contained character card recommends preserving its own world boundary', () => {
  const route = evaluateStoryImportRoute({
    kind: 'character-card',
    summary: { selfContained: true }
  }, { basePackId: 'xuanhuan', basePackTitle: '神荒玄幻' });

  assert.equal(route.recommendedMode, STORY_IMPORT_MODES.INDEPENDENT);
  assert.equal(route.compatibility, 'self-contained');
});

test('unknown standalone lore remains attachable and lets the creator decide', () => {
  const route = evaluateStoryImportRoute({
    kind: 'world-book',
    summary: { titles: ['百鬼录'] }
  }, { basePackId: 'lingyi', basePackTitle: '民俗灵异' });

  assert.equal(route.recommendedMode, STORY_IMPORT_MODES.ATTACH);
  assert.equal(route.compatibility, 'unknown');
  assert.equal(route.canAttach, true);
});

test('versioned content packs always install as independent stories', () => {
  const route = evaluateStoryImportRoute({ kind: 'content-pack', summary: {} }, {
    basePackId: 'xianxia',
    basePackTitle: '太虚仙侠'
  });

  assert.equal(route.recommendedMode, STORY_IMPORT_MODES.INDEPENDENT);
  assert.equal(route.canAttach, false);
});

test('prompt presets attach to an existing story baseline as supplemental assets', () => {
  const route = evaluateStoryImportRoute({ kind: 'prompt-preset', summary: {} }, {
    basePackId: 'xianxia',
    basePackTitle: '太虚仙侠'
  });

  assert.equal(route.recommendedMode, STORY_IMPORT_MODES.ATTACH);
  assert.equal(route.compatibility, 'supplemental');
  assert.equal(route.canAttach, true);
  assert.match(route.reason, /题材基线/);
});
