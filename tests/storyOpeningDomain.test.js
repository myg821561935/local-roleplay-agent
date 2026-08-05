import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENING_GENRE_OPTIONS,
  PROLOGUE_RANDOM_POOLS,
  createStoryOpeningRandomizer,
  getOpeningGenreOption,
  openingGenreIds
} from '../public/modules/storyOpening.js';

test('opening genre catalog exposes the supported story domains and a stable fallback', () => {
  assert.deepEqual(openingGenreIds(), [
    'xuanhuan',
    'lingyi',
    'mingmo',
    'xianxia',
    'yingxiongzhi'
  ]);
  assert.equal(OPENING_GENRE_OPTIONS.length, 5);
  assert.equal(getOpeningGenreOption('mingmo').title, '明末风云');
  assert.equal(getOpeningGenreOption('unknown').id, 'xuanhuan');
  assert.ok(PROLOGUE_RANDOM_POOLS.shared.genders.includes('不主动声明'));
});

test('story opening randomizer uses its injected pools and random source', () => {
  const pools = {
    shared: {
      genders: ['不声明']
    },
    xuanhuan: {
      surnames: ['沈'],
      givenNames: ['观澜'],
      roles: ['旧案调查者'],
      looks: ['灰衣旧刀'],
      marks: ['半枚旧印'],
      items: ['旧刀', '残图', '伤药', '路引', '铜扣'],
      secrets: ['掌握残缺口供'],
      goals: ['查清旧案']
    }
  };
  const randomizer = createStoryOpeningRandomizer({
    pools,
    random: () => 0
  });

  assert.deepEqual(randomizer.prologuePool('xuanhuan', 'genders'), ['不声明']);
  assert.equal(randomizer.generateSetupName('xuanhuan'), '沈观澜');
  assert.deepEqual(randomizer.randomMany(['甲', '乙', '丙'], 2), ['甲', '乙']);
  assert.equal(randomizer.composeInventory('xuanhuan'), '旧刀、残图、伤药、路引');
  assert.equal(
    randomizer.generateSetupFieldValue('xuanhuan', 'appearance', { label: '外貌' }),
    '灰衣旧刀，半枚旧印。'
  );
});

test('story opening field generation respects scoped values and disabled system fallback', () => {
  const randomizer = createStoryOpeningRandomizer({ random: () => 0 });

  assert.equal(
    randomizer.generateSetupFieldValue('xuanhuan', 'role', { values: ['游侠', '药师'] }),
    '游侠'
  );
  assert.equal(
    randomizer.generateSetupFieldValue('xuanhuan', 'goal', { defaultValue: '先活过今夜' }),
    '先活过今夜'
  );
  assert.equal(
    randomizer.generateSetupFieldValue(
      'xuanhuan',
      'custom',
      {},
      { custom: '保留现值' },
      { allowSystemFallback: false }
    ),
    '保留现值'
  );
  assert.equal(randomizer.canRandomizeSetupField({ values: ['甲', '乙'] }), true);
  assert.equal(
    randomizer.canRandomizeSetupField({ values: ['唯一值'] }, { allowSystemFallback: false }),
    false
  );
  assert.deepEqual(
    randomizer.getScopedSetupFieldValues({ values: [' 甲 ', '', null, '乙'] }),
    ['甲', '乙']
  );
});
