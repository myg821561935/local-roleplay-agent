import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetCatalog, filterAssetCatalog } from '../public/modules/assetCenter.js';

test('asset center builds a unified catalog for resources and content packs', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'character-1',
      kind: 'character',
      title: '谢停云',
      summary: '问剑入山的年轻修士。',
      tags: ['仙侠'],
      collections: ['问道主线'],
      favorite: true,
      diagnostics: { score: 91, estimatedTokens: 1800 },
      source: { community: '类脑社区', author: '测试作者' },
      payload: { role: '问剑人' },
      updatedAt: '2026-07-20T08:00:00.000Z'
    },
    {
      id: 'worldbook-1',
      kind: 'worldbook',
      title: '太虚山门录',
      diagnostics: { score: 86, estimatedTokens: 4200 },
      source: { site: 'local-file' },
      payload: { entries: [{ title: '山门戒律', content: '不可妄开天门。' }] }
    }
  ], [{
    id: 'xianxia',
    title: '太虚仙侠内容包',
    description: '大道争锋，仙途渺茫。',
    characterCount: 4,
    worldBookCount: 48,
    manifest: { version: '1.0.0' }
  }]);

  assert.deepEqual(catalog.map((item) => item.kind), ['character', 'worldbook', 'pack']);
  assert.equal(catalog[0].sourceLabel, '类脑社区');
  assert.equal(catalog[0].favorite, true);
  assert.equal(catalog[2].diagnostics.stats.entryCount, 48);
  assert.equal(catalog[2].diagnostics.stats.characterCount, 4);
});

test('asset center filters collections, source and kind while keeping favorites first', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'prompt-1',
      kind: 'prompt',
      title: '沉浸叙事预设',
      collections: ['待整理'],
      favorite: false,
      diagnostics: { score: 93 },
      source: { site: '本地素材' },
      updatedAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'character-1',
      kind: 'character',
      title: '谢停云',
      tags: ['仙侠'],
      collections: ['问道主线'],
      favorite: true,
      diagnostics: { score: 82 },
      source: { community: '类脑社区' },
      updatedAt: '2026-07-19T10:00:00.000Z'
    }
  ]);

  assert.deepEqual(filterAssetCatalog(catalog, { kind: 'all', sort: 'updated' }).map((item) => item.id), ['character-1', 'prompt-1']);
  assert.deepEqual(filterAssetCatalog(catalog, { kind: 'character', query: '问道' }).map((item) => item.id), ['character-1']);
  assert.deepEqual(filterAssetCatalog(catalog, { source: '本地素材', query: '待整理' }).map((item) => item.id), ['prompt-1']);
});

test('asset center groups same-title revisions and links companion worldbooks from one import', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'character-v1',
      kind: 'character',
      title: '听雨刀客 Ver1.7',
      source: { importBatchId: 'batch-1', version: '1.7' },
      payload: { name: '沈观澜' },
      updatedAt: '2026-07-19T10:00:00.000Z'
    },
    {
      id: 'character-v2',
      kind: 'character',
      title: '听雨刀客 Ver1.8',
      source: { importBatchId: 'batch-2', version: '1.8' },
      payload: { name: '沈观澜' },
      updatedAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'worldbook-1',
      kind: 'worldbook',
      title: '听雨楼设定集',
      source: { importBatchId: 'batch-1' },
      payload: { entries: [] }
    }
  ]);

  const first = catalog.find((item) => item.id === 'character-v1');
  assert.equal(first.versionCount, 2);
  assert.equal(first.companionWorldbookCount, 1);
  assert.deepEqual(filterAssetCatalog(catalog, { sort: 'versions' }).slice(0, 2).map((item) => item.kind), ['character', 'character']);
});
