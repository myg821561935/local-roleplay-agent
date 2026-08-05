import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARACTER_PRESETS,
  createSupplementalCharacterPreset
} from '../public/modules/characterPresets.js';
import {
  PROTAGONIST_GENERATOR,
  LINGYI_PROTAGONIST_GENERATOR,
  MINGMO_PROTAGONIST_GENERATOR,
  XIANXIA_PROTAGONIST_GENERATOR,
  createProtagonistGenerator
} from '../public/modules/protagonistGenerator.js';

test('built-in character presets retain required genre coverage and metadata', () => {
  const requiredPresetIds = [
    'custom_protagonist',
    'xuanhuan_wangshen',
    'xuanhuan_youquan',
    'xianxia_chisong',
    'xianxia_suyue',
    'lingyi_baiqiao',
    'lingyi_xuhe',
    'mingmo_zhaotiejing',
    'mingmo_shenruoxu'
  ];

  requiredPresetIds.forEach((id) => {
    assert.ok(CHARACTER_PRESETS[id], `missing built-in character preset: ${id}`);
    assert.equal(typeof CHARACTER_PRESETS[id].name, 'string');
    assert.equal(CHARACTER_PRESETS[id].enabled, true);
  });

  assert.equal(CHARACTER_PRESETS.xuanhuan_wangshen.extensions.contentPack, 'xuanhuan');
  assert.equal(CHARACTER_PRESETS.xianxia_chisong.extensions.contentPack, 'xianxia');
  assert.equal(CHARACTER_PRESETS.lingyi_baiqiao.extensions.contentPack, 'lingyi');
  assert.equal(CHARACTER_PRESETS.mingmo_zhaotiejing.extensions.contentPack, 'mingmo');
});

test('supplemental preset factory preserves local content-pack ownership', () => {
  const preset = createSupplementalCharacterPreset({
    name: '测试角色',
    role: '测试身份',
    description: '测试描述',
    personality: '测试性格',
    scenario: '测试场景',
    firstMessage: '测试开场',
    packId: 'xianxia',
    tags: ['测试'],
    tracking: '追踪测试字段'
  });

  assert.deepEqual(preset.extensions, {
    contentPack: 'xianxia',
    npcCard: true,
    supplemental: true
  });
  assert.deepEqual(preset.tags, ['测试', 'xianxia']);
  assert.equal(preset.enabled, true);
  assert.match(preset.creatorNotes, /独立目标、资源、恐惧和底线/);
});

test('protagonist generator pools keep every supported genre usable', () => {
  const requiredArraysByGenerator = [
    [PROTAGONIST_GENERATOR, ['surnames', 'givenNames', 'roles', 'realms', 'looks', 'secrets', 'goals', 'flaws', 'relationshipStyles', 'openings']],
    [LINGYI_PROTAGONIST_GENERATOR, ['surnames', 'givenNames', 'roles', 'marks', 'tools', 'cases', 'flaws', 'relationshipStyles', 'openings']],
    [MINGMO_PROTAGONIST_GENERATOR, ['surnames', 'givenNames', 'roles', 'papers', 'risks', 'goals', 'flaws', 'relationshipStyles', 'openings']],
    [XIANXIA_PROTAGONIST_GENERATOR, ['surnames', 'givenNames', 'roles', 'realms', 'roots', 'artifacts', 'vows', 'goals', 'flaws', 'relationshipStyles', 'openings']]
  ];

  requiredArraysByGenerator.forEach(([generator, fields]) => {
    fields.forEach((field) => {
      assert.ok(Array.isArray(generator[field]), `generator field must be an array: ${field}`);
      assert.ok(generator[field].length > 0, `generator field must not be empty: ${field}`);
    });
  });
});

test('protagonist generator dispatches every genre with deterministic output', () => {
  const generator = createProtagonistGenerator({
    createCharacterCardTemplate: () => ({ templateMarker: true }),
    generateSetupName: (genre) => `${genre}-name`,
    rollFromPool: (genre, key) => `${genre}-${key}`,
    composeInventory: (genre) => `${genre}-inventory`,
    random: () => 0
  });

  const expectedByGenre = [
    ['xuanhuan', '沈观澜', 'local-protagonist-generator'],
    ['lingyi', '陈默', 'local-lingyi-protagonist-generator'],
    ['mingmo', '顾怀砚', 'local-mingmo-protagonist-generator'],
    ['xianxia', '闻雪照', 'local-xianxia-protagonist-generator'],
    ['yingxiongzhi', 'yingxiongzhi-name', 'local-yingxiongzhi-protagonist-generator']
  ];

  expectedByGenre.forEach(([genre, name, generatorId]) => {
    const card = generator.generateProtagonistCard(genre);
    assert.equal(card.name, name);
    assert.equal(card.extensions.generator, generatorId);
    assert.equal(card.templateMarker, true);
    assert.equal(card.enabled, true);
  });

  assert.equal(
    generator.generateProtagonistCard('unsupported').extensions.generator,
    'local-protagonist-generator'
  );
});

test('Hero protagonist generation uses only the injected opening-pool adapter', () => {
  const requestedFields = [];
  const generator = createProtagonistGenerator({
    createCharacterCardTemplate: () => ({ templateMarker: true }),
    generateSetupName: (genre) => `${genre}-name`,
    rollFromPool: (genre, key) => {
      requestedFields.push([genre, key]);
      return `${genre}-${key}`;
    },
    composeInventory: (genre) => `${genre}-inventory`,
    random: () => {
      throw new Error('Hero generation must not read the static-pool random source');
    }
  });

  const card = generator.generateProtagonistCard('yingxiongzhi');

  assert.equal(card.role, 'yingxiongzhi-roles · yingxiongzhi-factions');
  assert.match(card.description, /yingxiongzhi-inventory/);
  assert.equal(card.extensions.knownInformation, 'yingxiongzhi-knowns');
  assert.equal(card.extensions.blindSpot, 'yingxiongzhi-blindSpots');
  assert.deepEqual(
    requestedFields.map(([, key]) => key),
    ['roles', 'factions', 'knowns', 'blindSpots', 'secrets', 'goals', 'nodes', 'pressures', 'flaws', 'relationStyles']
  );
});
