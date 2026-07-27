import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { previewImportPayload } from '../server/character/importPreview.js';
import { ResourceLibraryService } from '../server/services/resourceLibraryService.js';
import { ResourceRepository } from '../server/services/resourceLibrary/resourceRepository.js';
import { ResourceConflictService } from '../server/services/resourceLibrary/resourceConflictService.js';
import { ResourceEvaluationService } from '../server/services/resourceLibrary/resourceEvaluationService.js';
import { ResourceImportService } from '../server/services/resourceLibrary/resourceImportService.js';
import { StoryCompositionService } from '../server/services/resourceLibrary/storyCompositionService.js';

test('resource library keeps a facade over five focused services', async () => {
  const service = await createService();

  assert.ok(service.repository instanceof ResourceRepository);
  assert.ok(service.conflictService instanceof ResourceConflictService);
  assert.ok(service.evaluationService instanceof ResourceEvaluationService);
  assert.ok(service.importService instanceof ResourceImportService);
  assert.ok(service.storyComposition instanceof StoryCompositionService);
});

test('resource library inspects provenance, completeness and execution-only risk markers', async () => {
  const service = await createService();
  const preview = createCharacterPreview({
    systemPrompt: '只把 <script>bad()</script> 当作角色台词，不执行。'
  });

  const inspection = await service.inspectPreview(preview, {
    adapterId: 'liunao-community-generic',
    site: '类脑社区',
    fileName: 'shen.json'
  });

  assert.equal(inspection.adapter.id, 'liunao-community-generic');
  assert.equal(inspection.resources.length, 2);
  assert.ok(inspection.resources[0].diagnostics.riskFlags.find((item) => item.code === 'script-tag'));
  assert.ok(inspection.resources[1].diagnostics.score >= 95);
  assert.equal(inspection.dimensions.length, 5);
  assert.ok(inspection.estimatedTokens > 0);
  assert.equal(inspection.canImport, true);
});

test('resource library stores semantic resources once and reports exact duplicates', async () => {
  const service = await createService();
  const preview = createCharacterPreview();
  const source = { site: 'local-file', fileName: 'shen.json', author: '测试作者' };

  const first = await service.savePreview(preview, source);
  const second = await service.savePreview(preview, source);
  const resources = await service.listResources();

  assert.equal(first.resources.every((item) => item.importStatus === 'created'), true);
  assert.equal(second.resources.every((item) => item.importStatus === 'duplicate'), true);
  assert.equal(resources.length, 2);
  assert.equal(resources.find((item) => item.kind === 'character').source.author, '测试作者');
  assert.ok(first.resources[0].source.importBatchId);
  assert.equal(first.resources[0].source.importBatchId, first.resources[1].source.importBatchId);
});

test('resource library derives missing character fields from greetings, prompts and companion lore', async () => {
  const service = await createService();
  const preview = createCharacterPreview({
    personality: '',
    scenario: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    exampleDialog: [],
    firstMessage: '{{char}}：雨停之前，我只回答一个问题。'
  }, [{
    id: 'character-profile',
    title: '人物性格',
    content: '性格：寡言克制，对承诺近乎固执。',
    enabled: true
  }, {
    id: 'opening-scene',
    title: '开局场景',
    content: '当前场景：听雨楼闭门之后，旧案证人带伤来访。',
    enabled: true
  }, {
    id: 'roleplay-rules',
    title: '扮演约束',
    content: '必须保持武侠时代语境，不得主动透露旧案真凶。',
    enabled: true
  }]);

  const saved = await service.savePreview(preview, { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');

  assert.match(character.payload.personality, /寡言克制|承诺/);
  assert.match(character.payload.scenario, /听雨楼|旧案证人/);
  assert.match(character.payload.postHistoryInstructions, /武侠时代语境|不得主动透露/);
  assert.ok(character.payload.exampleDialog.some((item) => item.includes('雨停之前')));
  assert.deepEqual(
    character.payload.extensions.local_roleplay_agent.enrichment.generatedFields,
    ['personality', 'scenario', 'postHistoryInstructions', 'exampleDialog']
  );
  assert.equal(character.diagnostics.missingFields.some((item) => ['personality', 'scenario'].includes(item.field)), false);
  assert.equal(character.diagnostics.warnings.some((item) => item.code === 'CHARACTER_WITHOUT_BEHAVIOR_RULE'), false);
  assert.equal(character.diagnostics.warnings.some((item) => item.code === 'CHARACTER_WITHOUT_DIALOG_EXAMPLE'), false);
});

test('resource library reevaluates legacy assets and preserves authored character fields', async () => {
  const service = await createService();
  await service.store.write('library/resources/legacy-character.json', {
    id: 'legacy-character',
    kind: 'character',
    title: '旧版听雨刀客',
    summary: '旧素材',
    tags: ['武侠'],
    collections: [],
    favorite: false,
    format: 'character-card-v2',
    fingerprint: 'legacy',
    source: {
      site: '类脑社区',
      importBatchId: 'legacy-batch',
      importedAt: '2026-07-01T00:00:00.000Z'
    },
    diagnostics: { score: 0 },
    payload: {
      name: '沈观澜',
      description: '背负旧案的刀客。',
      personality: '作者明确写下的冷静性格。',
      scenario: '',
      firstMessage: '沈观澜：城门将在子时关闭。',
      exampleDialog: [],
      systemPrompt: '',
      postHistoryInstructions: '',
      extensions: {}
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  });
  await service.store.write('library/resources/legacy-worldbook.json', {
    id: 'legacy-worldbook',
    kind: 'worldbook',
    title: '旧案开局',
    fingerprint: 'legacy-worldbook',
    source: { site: '类脑社区', importBatchId: 'legacy-batch' },
    payload: {
      entries: [{
        id: 'legacy-opening',
        title: '开局场景与行为规则',
        content: '当前场景：城门戒严，证人失踪。必须隐瞒官府密令。',
        enabled: true
      }]
    }
  });

  const result = await service.reevaluateResource('legacy-character');

  assert.equal(result.resource.payload.personality, '作者明确写下的冷静性格。');
  assert.match(result.resource.payload.scenario, /城门戒严|证人失踪/);
  assert.match(result.resource.payload.postHistoryInstructions, /隐瞒官府密令/);
  assert.ok(result.resource.payload.exampleDialog.length > 0);
  assert.ok(result.resource.diagnostics.communityCompatibility);
  assert.ok(result.resource.diagnostics.score > 0);
  assert.deepEqual(result.enrichment.generatedFields, ['scenario', 'postHistoryInstructions', 'exampleDialog']);
  assert.equal(await service.reevaluateResource('missing-resource'), null);
});

test('resource library allows a duplicate character import to backfill its card portrait', async () => {
  const service = await createService();
  await service.savePreview(createCharacterPreview(), { site: 'local-file' });
  const embeddedPortraitPreview = createCharacterPreview();
  embeddedPortraitPreview.summary = { hasEmbeddedPortrait: true };
  const previewInspection = await service.inspectPreview(embeddedPortraitPreview, { site: 'local-file' });
  const assetId = 'a'.repeat(64);
  const previewWithPortrait = createCharacterPreview({
    portrait: {
      assetId,
      url: `/api/character-images/${assetId}.png`,
      mimeType: 'image/png',
      width: 512,
      height: 768,
      source: 'embedded-character-card'
    }
  });

  const inspection = await service.inspectPreview(previewWithPortrait, { site: 'local-file' });
  const saved = await service.savePreview(previewWithPortrait, { site: 'local-file' }, { inspection });
  const resources = await service.listResources();
  const character = resources.find((item) => item.kind === 'character');

  assert.equal(previewInspection.canImport, true);
  assert.equal(previewInspection.resources[0].diagnostics.conflicts[0].type, 'portrait-update');
  assert.equal(inspection.canImport, true);
  assert.equal(inspection.resources[0].diagnostics.conflicts[0].type, 'portrait-update');
  assert.ok(inspection.resources[0].diagnostics.warnings.find((item) => item.code === 'PORTRAIT_UPDATE'));
  assert.equal(saved.resources.find((item) => item.kind === 'character').importStatus, 'updated');
  assert.equal(saved.resources.find((item) => item.kind === 'worldbook').importStatus, 'duplicate');
  assert.equal(resources.length, 2);
  assert.equal(character.payload.portrait.url, `/api/character-images/${assetId}.png`);
});

test('resource library composes a custom pack from a base pack and selected resources', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    extensions: {
      regex_scripts: [{ findRegex: '/<status>[\\s\\S]*?<\\/status>/g', replaceString: '' }],
      quick_replies: [{ label: '问旧案', command: '/send 追问旧案' }],
      mvu: { values: { clueCount: 0 } },
      tavern_helper: {
        quickReplySet: [{ label: '查看线索', command: '/send <%= scene.name %>里还有什么线索？' }],
        variables: { values: { relationship: { shen: 12 } } },
        panels: [{ title: '关系档案', fields: [{ label: '好感', path: 'relationship.shen' }] }]
      }
    }
  }), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const basePack = {
    id: 'xianxia',
    title: '太虚仙侠',
    promptModules: [{ id: 'base-prompt', title: '基线', content: '遵循仙侠规则', enabled: true }],
    worldBook: [{ id: 'base-lore', title: '太虚界', content: '仙门治世。', keywords: ['太虚界'], enabled: true }],
    characterCard: { name: '旧主角' },
    memory: { memoryCards: [], worldState: { flags: { genre: 'xianxia' } } },
    ruleSystem: { id: 'xianxia-rules', title: '仙侠规则', boundary: '仙侠', panels: [] }
  };

  const pack = await service.createPack({
    title: '听雨仙途',
    basePackId: 'xianxia',
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  }, { basePack });

  assert.match(pack.id, /^custom-/);
  assert.equal(pack.characterCard.name, '沈观澜');
  assert.equal(pack.visualPackId, 'xianxia');
  assert.equal(pack.memory.resourcePackId, pack.id);
  assert.equal(pack.ruleSystem.contentPackId, pack.id);
  assert.ok(pack.worldBook.find((entry) => entry.title === '听雨楼'));
  assert.ok(pack.worldBook.find((entry) => entry.title === '太虚界'));
  assert.equal(pack.lightFrontend.regexTransforms.length, 1);
  assert.equal(pack.lightFrontend.quickReplies[0].template, '追问旧案');
  assert.ok(pack.lightFrontend.quickReplies.find((item) => item.label === '查看线索'));
  assert.equal(pack.lightFrontend.mvu.values.clueCount, 0);
  assert.equal(pack.lightFrontend.mvu.values.relationship.shen, 12);
  assert.equal(pack.lightFrontend.panels[0].title, '关系档案');
  assert.deepEqual(pack.lightFrontend.adapters[0].mappedCapabilities, ['quick-replies', 'sidebar-panels', 'mvu-state']);
  assert.equal(pack.lightFrontend.adapters[0].mode, 'declarative-partial');
  assert.equal(pack.openingTemplate.source, 'custom-pack');
  assert.equal(pack.openingTemplate.title, '听雨仙途');
  assert.equal(pack.openingTemplate.genre, 'xianxia');
  assert.equal(pack.openingTemplate.destinyCards.cards.some((card) => card.title.includes('雁回')), false);
  const summary = (await service.listPacks())[0];
  assert.equal(summary.basePackId, 'xianxia');
  assert.equal(summary.openingTemplate.title, '听雨仙途');
  assert.equal(summary.openingTemplate.genre, 'xianxia');
});

test('custom pack opening template follows imported character lore instead of its visual fallback', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    name: '云照影',
    description: '玄幻仙侠世界中的散修，身负特殊体质。',
    personality: '谨慎克制，不轻信宗门许诺。',
    scenario: '她在宗门试炼前夜发现自己的灵根与旧案有关。',
    firstMessage: '试炼钟声将在子时敲响，云照影必须在封山前找到被调换的名册。'
  }), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '云照影的独立仙途',
    visualPackId: 'xuanhuan',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  });

  assert.equal(pack.openingTemplate.genre, 'xianxia');
  assert.equal(pack.openingTemplate.title, '云照影的独立仙途');
  assert.match(pack.openingTemplate.subtitle, /云照影/);
  assert.ok(Object.values(pack.openingTemplate.tabs).some((tab) => tab.label === '听雨楼'));
  assert.equal(pack.openingTemplate.destinyCards.cards.some((card) => /雁回|粮仓灯火|天机榜异动/.test(card.title)), false);
  assert.match(pack.openingTemplate.fields.goal.defaultValue, /宗门试炼|散修|特殊体质/);
  assert.match(pack.openingTemplate.fields.openingPressure.defaultValue, /试炼钟声|封山|名册/);
  assert.doesNotMatch(pack.openingTemplate.fields.goal.defaultValue, /天道残缺|落雷秘境/);
  assert.doesNotMatch(pack.openingTemplate.fields.openingPressure.defaultValue, /落雷秘境/);
});

test('custom opening fields extract protagonist goals, risks, relationships, and alternate greetings from imported lore', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview({
    name: '仙侠雌竞-我是炉鼎体质',
    description: '凌霄宗外门杂役，身负不为人知的特殊体质。',
    scenario: '',
    firstMessage: '【作者署名】',
    alternateGreetings: [
      '三月初春，凌霄山脉云雾缭绕。{{user}}提着包裹站在外门杂役院前，江小鲤气喘吁吁地向他跑来。'
    ]
  }, [{
    id: 'protagonist-profile',
    title: '{{user}}人设',
    content: `<男主角>
[角色：凌霄宗外门杂役，特殊体质拥有者]
[背景与家庭生活：小渔村孤儿，从小与江小鲤相依为命。实际上拥有修真界第一体质"荒古肾体"，一旦暴露便会引来争夺。]
</男主角>`,
    enabled: true
  }, {
    id: 'constitution-risk',
    title: '体质发现与后果',
    content: `体质发现与后果
- 宗门高层：秘密圈养，当做宗门至宝
保密的重要性：荒古肾体一旦暴露，将成为整个修真界的焦点，无数势力会出手争夺。`,
    enabled: true
  }]), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '炉鼎体质的故事',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  });
  const fields = pack.openingTemplate.fields;

  assert.equal(fields.role.defaultValue, '凌霄宗外门杂役，特殊体质拥有者');
  assert.match(fields.goal.defaultValue, /荒古肾体|江小鲤/);
  assert.doesNotMatch(fields.goal.defaultValue, /["”]|。。/);
  assert.match(fields.secret.defaultValue, /一旦暴露|整个修真界|争夺/);
  assert.notEqual(fields.secret.defaultValue, '体质发现与后果');
  assert.match(fields.relationshipStyle.defaultValue, /江小鲤|相依为命/);
  assert.match(fields.openingPressure.defaultValue, /外门杂役院|江小鲤/);
  assert.doesNotMatch(JSON.stringify(fields), /天道残缺|同命格敌手|落雷秘境/);
});

test('genre inheritance keeps portable rules without importing the base story route or memory', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const basePack = {
    id: 'xianxia',
    title: '太虚仙侠',
    promptModules: [
      { id: 'xianxia-core-rules', title: '修行通用规则', content: '修行必须支付代价。', enabled: true },
      { id: 'xianxia-core-route-contract', title: '断魂灯固定主线', content: '始终追查断魂灯。', enabled: true }
    ],
    worldBook: [
      {
        id: 'portable-cultivation-rules',
        title: '修行通则',
        content: '境界突破必须积累。',
        enabled: true,
        extensions: { inheritanceScope: 'genre' }
      },
      { id: 'base-lore', title: '太虚界', content: '落雷山脉藏有断魂灯。', enabled: true }
    ],
    characterCard: { name: '旧主角' },
    memory: {
      rollingSummary: '闻雪照正在追查断魂灯。',
      worldState: {
        flags: { genre: 'xianxia' },
        quests: [{ title: '补全断魂灯', status: 'active' }]
      },
      memoryCards: [{ id: 'old-plot', title: '旧主线', content: '落雷山脉' }]
    },
    ruleSystem: {
      id: 'xianxia-rules',
      title: '太虚规则',
      boundary: '只使用太虚人物与旧案。',
      panels: [{ id: 'old-route', title: '断魂灯', content: '固定主线' }]
    }
  };

  const pack = await service.createPack({
    title: '导入角色新卷',
    basePackId: 'xianxia',
    baseInheritanceMode: 'genre',
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id]
  }, { basePack });

  assert.equal(pack.resourceManifest.baseInheritanceMode, 'genre');
  assert.ok(pack.worldBook.find((entry) => entry.title === '修行通则'));
  assert.ok(pack.worldBook.find((entry) => entry.title === '听雨楼'));
  assert.equal(pack.worldBook.some((entry) => entry.title === '太虚界'), false);
  assert.ok(pack.promptModules.find((module) => module.id === 'xianxia-core-rules'));
  assert.equal(pack.promptModules.some((module) => module.id === 'xianxia-core-route-contract'), false);
  assert.equal(pack.memory.rollingSummary, '');
  assert.deepEqual(pack.memory.memoryCards, []);
  assert.equal(pack.memory.worldState.flags.genre, 'xianxia');
  assert.deepEqual(pack.ruleSystem.panels, []);
  assert.match(pack.ruleSystem.boundary, /角色卡及其同批世界书决定/);
});

test('resource library can promote an imported character portrait to the story stage background', async () => {
  const service = await createService();
  const assetId = 'b'.repeat(64);
  const saved = await service.savePreview(createCharacterPreview({
    portrait: {
      assetId,
      url: `/api/character-images/${assetId}.png`,
      mimeType: 'image/png',
      width: 512,
      height: 768,
      source: 'embedded-character-card'
    }
  }), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');

  const pack = await service.createPack({
    title: '听雨新卷',
    characterResourceId: character.id,
    useCharacterPortraitAsBackground: true,
    customBaseline: {
      worldName: '听雨江湖',
      genre: '低魔武侠',
      premise: '门派以驿路和盐道争夺生计。'
    }
  });
  const summary = (await service.listPacks())[0];

  assert.deepEqual(pack.stageBackground, {
    url: `/api/character-images/${assetId}.png`,
    assetId,
    source: 'character-portrait',
    fit: 'portrait',
    label: '沈观澜立绘'
  });
  assert.deepEqual(summary.stageBackground, pack.stageBackground);
});

test('resource library previews world book conflicts and smart merge replaces same-title base entries', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const basePack = {
    id: 'wuxia',
    title: '武侠基线',
    promptModules: [],
    worldBook: [{
      id: 'base-tingyu',
      title: '听雨楼',
      content: '听雨楼只是一间普通客栈。',
      keywords: ['听雨楼'],
      enabled: true
    }],
    characterCard: { name: '旧主角' },
    memory: { memoryCards: [], worldState: { flags: { genre: 'wuxia' } } },
    ruleSystem: { id: 'wuxia-rules', title: '武侠规则', boundary: '武侠', panels: [] }
  };

  const composition = await service.inspectPackComposition({
    worldBookResourceIds: [worldBook.id],
    worldBookMergeMode: 'smart'
  }, { basePack });
  assert.equal(composition.summary.sameTitleConflicts, 1);
  assert.equal(composition.summary.replacedBaseEntries, 1);
  assert.equal(composition.summary.finalEntries, 1);

  const pack = await service.createPack({
    title: '听雨新卷',
    worldBookResourceIds: [worldBook.id],
    worldBookMergeMode: 'smart'
  }, { basePack });
  assert.equal(pack.worldBook.length, 1);
  assert.equal(pack.worldBook[0].content, '听雨楼以消息定价，不问来路。');
  assert.equal(pack.resourceManifest.composition.sameTitleConflicts, 1);
});

test('resource library validates prompt id conflicts and external runtime requirements before composition', async () => {
  const service = await createService();
  const savedPrompt = await service.savePromptResource({
    id: 'base-prompt',
    title: '社区叙事预设',
    content: '依赖酒馆助手更新变量；最终行文保持克制。',
    source: { site: '类脑社区' }
  });
  const prompt = savedPrompt.resources[0];
  const basePack = {
    id: 'wuxia',
    title: '武侠基线',
    promptModules: [{ id: 'base-prompt', title: '基线叙事', content: '遵循江湖规则。', enabled: true }],
    worldBook: [],
    characterCard: { name: '旧主角' },
    memory: { memoryCards: [], worldState: { flags: { genre: 'wuxia' } } },
    ruleSystem: { id: 'wuxia-rules', title: '武侠规则', boundary: '武侠', panels: [] }
  };

  const inspection = await service.inspectPackComposition({
    promptResourceIds: [prompt.id]
  }, { basePack });

  assert.equal(inspection.summary.promptIdConflicts, 1);
  assert.equal(inspection.summary.replacedPromptModules, 1);
  assert.equal(inspection.promptModules.final, 1);
  assert.equal(inspection.communityCompatibility.level, 'external-runtime');
  assert.equal(inspection.communityCompatibility.counts.missing, 1);

  const pack = await service.createPack({
    title: '社区预设卷',
    promptResourceIds: [prompt.id]
  }, { basePack });
  assert.equal(pack.promptModules.length, 1);
  assert.equal(pack.promptModules[0].title, '社区叙事预设');
  assert.equal(pack.resourceManifest.composition.promptModules.promptIdConflicts, 1);
});

test('resource library stores SillyTavern preset modules in order and reports disabled runtime dependencies', async () => {
  const service = await createService();
  const preview = previewImportPayload({
    fileName: 'community-preset.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      name: '社区长篇预设',
      settings: { max_context: 48000, temperature: 0.76 },
      prompts: [
        {
          id: 'main',
          name: '主提示',
          enabled: true,
          role: 'system',
          content: '先遵循世界边界，再推进人物关系。',
          position: { type: 'relative' }
        },
        {
          id: 'history-rule',
          name: '历史后约束',
          enabled: true,
          role: 'user',
          content: '不得跳出角色解释规则。',
          position: { type: 'in_chat', depth: 1, order: 5 }
        }
      ],
      extensions: {
        regex_scripts: [{ scriptName: '状态过滤' }],
        tavern_helper: { scripts: [{ id: 'state-hook' }] }
      }
    })
  });

  const inspection = await service.inspectPreview(preview, {
    site: '类脑社区',
    fileName: 'community-preset.json'
  });
  const saved = await service.savePreview(preview, {
    site: '类脑社区',
    fileName: 'community-preset.json'
  }, { inspection });

  assert.equal(inspection.adapter.id, 'sillytavern-prompt-preset');
  assert.equal(inspection.resources.length, 2);
  assert.equal(inspection.communityCompatibility.level, 'external-runtime');
  assert.equal(
    inspection.communityCompatibility.requirements.find((item) => item.id === 'prompt-preset-order').status,
    'supported'
  );
  assert.equal(
    inspection.communityCompatibility.requirements.find((item) => item.id === 'tavern-helper').status,
    'missing'
  );
  assert.equal(saved.resources[0].payload.title, '主提示');
  assert.equal(saved.resources[1].payload.position, 'in_chat');
  assert.equal(saved.resources[1].payload.depth, 1);
  assert.equal(
    saved.resources[0].payload.extensions.sillyTavernPreset.generationSettings.maxContext,
    48000
  );
});

test('resource library creates a runnable original pack without a parent content pack', async () => {
  const service = await createService();
  const pack = await service.createPack({
    title: '九州残卷',
    worldBookMergeMode: 'smart',
    customBaseline: {
      worldName: '九州残卷',
      genre: '低魔武侠',
      premise: '九州诸侯割据，江湖门派依附盐路与驿道生存。',
      proseStyle: '克制对白，重人情与制度后果。',
      hardRules: '伤势、路引与钱粮必须持续有效。',
      visualPackId: 'yingxiongzhi'
    }
  });

  assert.equal(pack.resourceManifest.basePackId, '');
  assert.equal(pack.visualPackId, 'yingxiongzhi');
  assert.equal(pack.worldBook.length, 2);
  assert.equal(pack.worldBook.every((entry) => entry.constant), true);
  assert.equal(pack.promptModules.length, 1);
  assert.match(pack.promptModules[0].content, /克制对白/);
  assert.match(pack.ruleSystem.boundary, /伤势/);
});

test('stored packs can update bookshelf metadata and be removed without deleting source resources', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const pack = await service.createPack({
    title: '旧剧本名',
    characterResourceId: character.id,
    customBaseline: { worldName: '听雨江湖', genre: '武侠' }
  });

  const updated = await service.updatePackMetadata(pack.id, {
    title: '听雨江湖 · 新卷',
    description: '只修改书架元数据。',
    sessionTitle: '听雨江湖'
  });
  const removed = await service.removePack(pack.id);

  assert.equal(updated.title, '听雨江湖 · 新卷');
  assert.equal(updated.manifest.title, '听雨江湖 · 新卷');
  assert.equal(updated.characterCard.name, pack.characterCard.name);
  assert.equal(removed, true);
  assert.equal(await service.getPack(pack.id), null);
  assert.ok(await service.getResource(character.id));
});

test('independent copy freezes selected resource provenance without inheriting a base pack', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), {
    adapterId: 'liunao-community-generic',
    site: '类脑社区',
    url: 'https://example.test/cards/shen',
    author: '原作者',
    license: '未声明',
    version: '1.75',
    fileName: '武侠-Ver1.75.png',
    originalHash: 'sha256-example'
  });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');

  const pack = await service.createPack({
    title: '听雨独立卷',
    creationMode: 'independent-copy',
    includeBaseContent: false,
    characterResourceId: character.id,
    worldBookResourceIds: [worldBook.id],
    customBaseline: {
      worldName: '听雨江湖',
      genre: '武侠',
      premise: '只采用本次导入设定。'
    }
  });

  assert.equal(pack.resourceManifest.creationMode, 'independent-copy');
  assert.equal(pack.resourceManifest.basePackId, '');
  assert.equal(pack.resourceManifest.includeBaseContent, false);
  assert.equal(pack.resourceManifest.sourceResources.length, 2);
  assert.deepEqual(
    pack.resourceManifest.sourceResources.map((item) => item.id).sort(),
    [character.id, worldBook.id].sort()
  );
  assert.equal(pack.resourceManifest.sourceResources[0].source.site, '类脑社区');
  assert.equal(pack.resourceManifest.sourceResources[0].source.author, '原作者');
  assert.equal(pack.resourceManifest.sourceResources[0].source.fileName, '武侠-Ver1.75.png');
});

test('resource library updates collection metadata without mutating imported payloads', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const originalPayload = structuredClone((await service.getResource(character.id)).payload);

  const updated = await service.updateResourceMetadata(character.id, {
    title: '听雨刀客',
    summary: '旧案主线的核心人物。',
    tags: ['武侠', '旧案', '武侠'],
    collections: ['英雄群像', '待开局'],
    favorite: true
  });
  const queryResult = await service.listResources({ query: '英雄群像' });

  assert.equal(updated.title, '听雨刀客');
  assert.equal(updated.favorite, true);
  assert.deepEqual(updated.tags, ['武侠', '旧案']);
  assert.deepEqual(updated.collections, ['英雄群像', '待开局']);
  assert.deepEqual(updated.payload, originalPayload);
  assert.equal(queryResult[0].id, character.id);
  assert.equal(await service.updateResourceMetadata('missing-resource', { favorite: true }), null);
});

test('resource library updates world book entries and prompt modules as managed asset content', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: 'local-file' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  const updatedWorldBook = await service.updateResourcePayload(worldBook.id, {
    payload: {
      entries: [{
        id: 'lore-rain',
        title: '雨夜规矩',
        keywords: ['雨夜'],
        content: '雨夜不得直呼死者姓名。',
        enabled: true,
        depth: 6
      }]
    }
  });
  const promptSaved = await service.savePromptResource({
    title: '克制叙事',
    content: '保持克制的第三人称叙事。',
    enabled: true,
    source: { site: 'local-file' }
  });
  const prompt = promptSaved.resources[0];
  const updatedPrompt = await service.updateResourcePayload(prompt.id, {
    title: '克制叙事 · 修订',
    payload: {
      ...prompt.payload,
      role: 'system',
      position: 'in_chat',
      depth: 3,
      content: '保持克制的第三人称叙事，并避免替用户决定行动。',
      enabled: true
    }
  });

  assert.equal(updatedWorldBook.payload.entries.length, 1);
  assert.equal(updatedWorldBook.payload.entries[0].title, '雨夜规矩');
  assert.equal(updatedWorldBook.payload.entries[0].depth, 6);
  assert.ok(updatedWorldBook.diagnostics.score > 0);
  assert.equal(updatedPrompt.title, '克制叙事 · 修订');
  assert.equal(updatedPrompt.payload.role, 'system');
  assert.equal(updatedPrompt.payload.position, 'in_chat');
  assert.equal(updatedPrompt.payload.content.includes('避免替用户决定行动'), true);
  await assert.rejects(
    () => service.updateResourcePayload(character.id, { payload: character.payload }),
    /RESOURCE_CONTENT_KIND_UNSUPPORTED/
  );
  assert.equal(await service.updateResourcePayload('missing-resource', { payload: {} }), null);
});

test('resource library batch organization merges labels and exports portable asset bundles', async () => {
  const service = await createService();
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区', author: '社区作者' });
  const character = saved.resources.find((item) => item.kind === 'character');
  const worldBook = saved.resources.find((item) => item.kind === 'worldbook');
  await service.updateResourceMetadata(character.id, { tags: ['武侠'], collections: ['待整理'] });

  const organized = await service.updateResourcesMetadata([character.id, worldBook.id, 'missing-resource'], {
    tags: ['主线'],
    collections: ['英雄群像'],
    mode: 'merge'
  });
  const updatedCharacter = await service.getResource(character.id);
  const bundle = await service.exportResourceBundle([character.id, worldBook.id, 'missing-resource']);

  assert.equal(organized.updated.length, 2);
  assert.deepEqual(organized.missing, ['missing-resource']);
  assert.deepEqual(updatedCharacter.tags, ['武侠', '主线']);
  assert.deepEqual(updatedCharacter.collections, ['待整理', '英雄群像']);
  assert.equal(bundle.schema, 'local-roleplay-agent.asset-bundle/v1');
  assert.equal(bundle.resources.length, 2);
  assert.equal(bundle.resources[0].source.author, '社区作者');
  assert.equal(bundle.resources[0].payload.name, '沈观澜');
  assert.deepEqual(bundle.missing, ['missing-resource']);

  const removed = await service.removeResources([character.id, 'missing-resource']);
  assert.deepEqual(removed.removed, [character.id]);
  assert.deepEqual(removed.missing, ['missing-resource']);
});

async function createService() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'resource-library-'));
  return new ResourceLibraryService(new JsonStore(rootDir), {
    now: () => new Date('2026-07-14T08:00:00.000Z')
  });
}

function createCharacterPreview(overrides = {}, worldBook = null) {
  return {
    kind: 'character-card',
    importData: {
      characterCard: {
        name: '沈观澜',
        description: '背负旧案的年轻刀客。',
        personality: '克制，重诺。',
        scenario: '雨夜进入听雨楼。',
        firstMessage: '檐下的雨，像一场没有写完的供词。',
        exampleDialog: ['用户：你来找谁？', '沈观澜：找一个不该死的人。'],
        systemPrompt: '保持武侠叙事边界。',
        tags: ['武侠', '悬案'],
        sourceSpec: 'chara_card_v2',
        ...overrides
      },
      worldBook: Array.isArray(worldBook) ? worldBook : [{
        id: 'lore-tingyu',
        title: '听雨楼',
        keywords: ['听雨楼'],
        content: '听雨楼以消息定价，不问来路。',
        enabled: true
      }]
    }
  };
}
