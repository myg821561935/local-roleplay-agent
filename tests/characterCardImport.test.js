import test from 'node:test';
import assert from 'node:assert/strict';
import { importCharacterCardFromPayload } from '../server/character/characterCardImport.js';

test('imports Character Card V2 JSON into local character card and world book entries', () => {
  const imported = importCharacterCardFromPayload({
    fileName: 'shen.json',
    mimeType: 'application/json',
    data: JSON.stringify(v2CardFixture())
  });

  assert.equal(imported.characterCard.name, '沈观澜');
  assert.equal(imported.characterCard.firstMessage, '夜雨打在刀鞘上。');
  assert.deepEqual(imported.characterCard.alternateGreetings, ['雨还没停。']);
  assert.equal(imported.characterCard.systemPrompt, '保持武侠叙事。');
  assert.equal(imported.worldBook.length, 1);
  assert.equal(imported.worldBook[0].title, '镇武司暗线');
  assert.deepEqual(imported.worldBook[0].keywords, ['镇武司']);
  assert.deepEqual(imported.worldBook[0].secondaryKeywords, ['暗线']);
  assert.equal(imported.worldBook[0].logic, 'selective');
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
  assert.equal(imported.worldBook[0].source, 'character-card-v2');
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
