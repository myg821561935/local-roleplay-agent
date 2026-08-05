import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCharacterCardImage,
  importCharacterCardFromPayload
} from '../server/character/characterCardImport.js';
import { exportCharacterCardPng } from '../server/character/characterCardExport.js';

test('imports Character Card V2 JSON into local character card and world book entries', () => {
  const imported = importCharacterCardFromPayload({
    fileName: 'shen.json',
    mimeType: 'application/json',
    data: JSON.stringify(v2CardFixture())
  });

  assert.equal(imported.characterCard.name, '沈观澜');
  assert.equal(imported.characterCard.role, '');
  assert.equal(imported.characterCard.creator, 'liufeng');
  assert.equal(imported.characterCard.firstMessage, '夜雨打在刀鞘上。');
  assert.deepEqual(imported.characterCard.alternateGreetings, ['雨还没停。']);
  assert.equal(imported.characterCard.systemPrompt, '保持武侠叙事。');
  assert.equal(imported.characterCard.extensions.local_roleplay_agent.sourceFileName, 'shen.json');
  assert.equal(imported.worldBook.length, 1);
  assert.equal(imported.worldBook[0].title, '镇武司暗线');
  assert.deepEqual(imported.worldBook[0].keywords, ['镇武司']);
  assert.deepEqual(imported.worldBook[0].secondaryKeywords, ['暗线']);
  assert.equal(imported.worldBook[0].logic, 'and_any');
  assert.equal(imported.worldBook[0].depth, 6);
});

test('imports Character Card V2 from PNG Chara metadata', () => {
  const png = createPngWithTextChunk('Chara', Buffer.from(JSON.stringify(v2CardFixture()), 'utf8').toString('base64'));
  const imported = importCharacterCardFromPayload({
    fileName: 'shen.png',
    mimeType: 'image/png',
    data: png.toString('base64'),
    encoding: 'base64'
  });

  assert.equal(imported.characterCard.name, '沈观澜');
  assert.equal(imported.characterCard.sourceSpec, 'chara_card_v2');
  assert.equal(imported.characterCard.extensions.local_roleplay_agent.sourceFileName, 'shen.png');
  assert.equal(imported.worldBook[0].source, 'character-card-v2');
});

test('extracts the original PNG portrait and keeps its pixels when exporting an updated card', () => {
  const original = exportCharacterCardPng({
    name: '旧名',
    description: '原始角色。',
    firstMessage: '旧开场。'
  });
  const extracted = extractCharacterCardImage({
    fileName: 'portrait.png',
    mimeType: 'image/png',
    data: original.toString('base64'),
    encoding: 'base64'
  });
  const updated = exportCharacterCardPng({
    name: '新名',
    description: '更新后的角色。',
    firstMessage: '新开场。'
  }, [], extracted.bytes);
  const reimported = importCharacterCardFromPayload({
    fileName: 'updated.png',
    mimeType: 'image/png',
    data: updated.toString('base64'),
    encoding: 'base64'
  });

  assert.equal(extracted.mimeType, 'image/png');
  assert.equal(extracted.width, 256);
  assert.equal(extracted.height, 256);
  assert.deepEqual(readChunkData(updated, 'IDAT'), readChunkData(original, 'IDAT'));
  assert.equal(reimported.characterCard.name, '新名');
  assert.equal(reimported.characterCard.firstMessage, '新开场。');
});

test('removes embedded character metadata before persisting a large PNG portrait', () => {
  const oversizedMetadata = Buffer.alloc(12 * 1024 * 1024 + 1, 0x41);
  const original = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk('tEXt', Buffer.concat([Buffer.from('chara\0', 'latin1'), oversizedMetadata])),
    createChunk('tEXt', Buffer.from('author\0community', 'latin1')),
    createChunk('IDAT', Buffer.from('portrait-pixels')),
    createChunk('IEND', Buffer.alloc(0))
  ]);

  const extracted = extractCharacterCardImage({
    fileName: 'large-card.png',
    mimeType: 'image/png',
    data: original.toString('base64'),
    encoding: 'base64'
  });

  assert.ok(original.length > 12 * 1024 * 1024);
  assert.ok(extracted.bytes.length < 12 * 1024 * 1024);
  assert.equal(hasTextChunk(extracted.bytes, 'chara'), false);
  assert.equal(hasTextChunk(extracted.bytes, 'author'), true);
  assert.deepEqual(readChunkData(extracted.bytes, 'IDAT'), Buffer.from('portrait-pixels'));
});

test('imports Character Card V3 PNG envelope and embedded lore settings', () => {
  const png = createPngWithTextChunk('Chara', Buffer.from(JSON.stringify(v3CardFixture()), 'utf8').toString('base64'));
  const imported = importCharacterCardFromPayload({
    fileName: 'daqian.png',
    mimeType: 'image/png',
    data: png.toString('base64'),
    encoding: 'base64'
  });

  assert.equal(imported.characterCard.name, '大乾风华录');
  assert.equal(imported.characterCard.sourceSpec, 'chara_card_v3');
  assert.deepEqual(imported.characterCard.alternateGreetings, ['朝堂开局。', '江湖开局。']);
  assert.equal(imported.worldBook.length, 1);
  assert.equal(imported.worldBook[0].source, 'character-card-v3');
  assert.equal(imported.worldBook[0].matchMode, 'selective');
  assert.deepEqual(imported.worldBook[0].keywords, []);
  assert.deepEqual(imported.worldBook[0].regex, ['旧案.*密信']);
  assert.deepEqual(imported.worldBook[0].secondaryKeywords, ['雨夜']);
  assert.equal(imported.worldBook[0].secondaryMatchMode, 'regex');
  assert.equal(imported.worldBook[0].depth, 7);
  assert.equal(imported.worldBook[0].caseSensitive, true);
  assert.equal(imported.worldBook[0].position, 'before_character');
});

function v2CardFixture() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳，重诺。',
      scenario: '正在调查镇武司旧案。',
      first_mes: '夜雨打在刀鞘上。',
      mes_example: '<START>\n用户：你是谁？\n沈观澜：过路人。',
      creator_notes: '个人创作用卡。',
      system_prompt: '保持武侠叙事。',
      post_history_instructions: '不要忘记旧案线索。',
      alternate_greetings: ['雨还没停。'],
      tags: ['武侠'],
      creator: 'liufeng',
      character_version: '1.0.0',
      extensions: { local: { note: 'keep' } },
      character_book: {
        name: '沈观澜世界书',
        scan_depth: 6,
        token_budget: 500,
        recursive_scanning: true,
        extensions: {},
        entries: [{
          id: 7,
          name: '镇武司暗线',
          keys: ['镇武司'],
          secondary_keys: ['暗线'],
          selective: true,
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true,
          insertion_order: 10,
          priority: 80,
          extensions: {}
        }]
      }
    }
  };
}

function v3CardFixture() {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '大乾风华录',
      first_mes: '风雨将至。',
      alternate_greetings: ['朝堂开局。', '江湖开局。'],
      tags: ['武侠', '群像'],
      extensions: {},
      character_book: {
        name: '大乾世界书',
        entries: [{
          id: 12,
          comment: '雨夜旧案',
          keys: ['旧案.*密信'],
          secondary_keys: ['雨夜'],
          content: '密信牵出一桩旧案。',
          constant: false,
          selective: true,
          insertion_order: 18,
          enabled: true,
          position: 'before_char',
          use_regex: true,
          extensions: {
            depth: 7,
            case_sensitive: true,
            selectiveLogic: 0
          }
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

function readChunkData(png, expectedType) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === expectedType) return png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  return null;
}

function hasTextChunk(png, keyword) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const separator = data.indexOf(0);
      if (separator >= 0) {
        const encoding = type === 'iTXt' ? 'utf8' : 'latin1';
        if (data.subarray(0, separator).toString(encoding) === keyword) return true;
      }
    }
    offset += 12 + length;
  }
  return false;
}

test('normalizes numeric world book position to global after_character/before_character', () => {
  const fixture = {
    spec: 'chara_card_v2',
    data: {
      name: '测试卡',
      description: '描述',
      character_book: {
        entries: [
          { id: 1, content: '条目1', position: 0 },
          { id: 2, content: '条目2', position: 1 },
          { id: 3, content: '条目3', position: 'after_char' },
          { id: 4, content: '条目4', position: 'before_char' }
        ]
      }
    }
  };
  const imported = importCharacterCardFromPayload({
    fileName: 'test.json',
    mimeType: 'application/json',
    data: JSON.stringify(fixture)
  });
  assert.equal(imported.worldBook[0].position, 'before_character');
  assert.equal(imported.worldBook[1].position, 'after_character');
  assert.equal(imported.worldBook[2].position, 'after_character');
  assert.equal(imported.worldBook[3].position, 'before_character');
});

test('filters out disabled world book entries with disable: true', () => {
  const fixture = {
    spec: 'chara_card_v2',
    data: {
      name: '测试卡',
      description: '描述',
      character_book: {
        entries: [
          { id: 1, content: '启用', disable: false },
          { id: 2, content: '禁用', disable: true },
          { id: 3, content: '默认启用' }
        ]
      }
    }
  };
  const imported = importCharacterCardFromPayload({
    fileName: 'test.json',
    mimeType: 'application/json',
    data: JSON.stringify(fixture)
  });
  assert.equal(imported.worldBook.length, 2);
  assert.equal(imported.worldBook[0].content, '启用');
  assert.equal(imported.worldBook[1].content, '默认启用');
});
