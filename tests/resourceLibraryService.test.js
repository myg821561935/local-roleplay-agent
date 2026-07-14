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
  assert.equal(inspection.resources[1].diagnostics.score, 100);
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
