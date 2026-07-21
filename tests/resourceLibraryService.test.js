import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ResourceLibraryService } from '../server/services/resourceLibraryService.js';

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
  const saved = await service.savePreview(createCharacterPreview(), { site: '类脑社区' });
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
  assert.equal((await service.listPacks())[0].basePackId, 'xianxia');
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

function createCharacterPreview(overrides = {}) {
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
      worldBook: [{
        id: 'lore-tingyu',
        title: '听雨楼',
        keywords: ['听雨楼'],
        content: '听雨楼以消息定价，不问来路。',
        enabled: true
      }]
    }
  };
}
