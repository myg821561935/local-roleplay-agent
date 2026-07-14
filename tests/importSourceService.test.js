import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportSourceService, listImportSources } from '../server/services/importSourceService.js';

test('lists supported character card and lorebook sources', () => {
  const sources = listImportSources();

  assert.ok(sources.find((source) => source.id === 'chub'));
  assert.ok(sources.find((source) => source.id === 'aicharactercards'));
  assert.ok(sources.find((source) => source.id === 'risurealm'));
  assert.ok(sources.find((source) => source.id === 'charavault'));
  assert.equal(sources.find((source) => source.id === 'chub').supports.includes('lorebooks'), true);
});

test('search maps Chub character results to importable cards', async () => {
  const service = new ImportSourceService({
    fetchImpl: async (url) => {
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.hostname, 'gateway.chub.ai');
      assert.equal(requestUrl.searchParams.get('namespace'), 'characters');
      assert.equal(requestUrl.searchParams.get('search'), 'wuxia');
      return jsonResponse({
        results: [{
          name: '沈观澜',
          fullPath: 'liufeng/shen-guanlan',
          tagline: '雨夜刀客',
          nTokens: 2048,
          topics: ['wuxia', 'original'],
          max_res_url: 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png'
        }]
      });
    }
  });

  const result = await service.search({ source: 'chub', query: 'wuxia', kind: 'characters' });

  assert.equal(result.source.id, 'chub');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '沈观澜');
  assert.equal(result.items[0].id, 'liufeng/shen-guanlan');
  assert.equal(result.items[0].type, 'character-card');
  assert.equal(result.items[0].tokenCount, 2048);
  assert.deepEqual(result.items[0].tags, ['wuxia', 'original']);
  assert.equal(result.items[0].downloadable, true);
});

test('search maps AICharacterCards API results', async () => {
  const service = new ImportSourceService({
    fetchImpl: async (url) => {
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.hostname, 'api.aicharactercards.com');
      assert.equal(requestUrl.pathname, '/api/cards');
      assert.equal(requestUrl.searchParams.get('search'), 'dungeon');
      return jsonResponse({
        cards: [{
          id: 140,
          name: 'Dungeon Master',
          description: 'A flexible narrator for dungeon crawls.',
          tags: ['fantasy', 'game-master'],
          downloadCount: 992,
          tokenCount: 1875
        }]
      });
    }
  });

  const result = await service.search({ source: 'aicharactercards', query: 'dungeon' });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, '140');
  assert.equal(result.items[0].sourceId, 'aicharactercards');
  assert.equal(result.items[0].downloadable, true);
  assert.equal(result.items[0].sourceUrl, 'https://aicharactercards.com/cards/140');
});

test('downloads a source PNG and returns the shared import preview payload', async () => {
  const png = createPngWithTextChunk(
    'Chara',
    Buffer.from(JSON.stringify(createV2CardPayload()), 'utf8').toString('base64')
  );
  const service = new ImportSourceService({
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png');
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : '' },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
      };
    }
  });

  const result = await service.download({
    source: 'chub',
    downloadUrl: 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png',
    fileName: 'shen-guanlan.png'
  });

  assert.equal(result.payload.mimeType, 'image/png');
  assert.equal(result.payload.encoding, 'base64');
  assert.equal(result.preview.kind, 'character-card');
  assert.equal(result.preview.summary.characterName, '沈观澜');
});

test('download rejects URLs outside the selected source allowlist', async () => {
  const service = new ImportSourceService({ fetchImpl: async () => jsonResponse({}) });

  await assert.rejects(
    () => service.download({
      source: 'chub',
      downloadUrl: 'http://127.0.0.1/private.png'
    }),
    { code: 'IMPORT_SOURCE_URL_NOT_ALLOWED' }
  );
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function createV2CardPayload() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳。',
      scenario: '旧案开局。',
      first_mes: '夜雨打在刀鞘上。',
      mes_example: '',
      tags: ['武侠'],
      character_book: {
        entries: [{
          name: '镇武司暗线',
          keys: ['镇武司'],
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true
        }]
      }
    }
  };
}

function createPngWithTextChunk(keyword, text) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1')),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([
    length,
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4)
  ]);
}
