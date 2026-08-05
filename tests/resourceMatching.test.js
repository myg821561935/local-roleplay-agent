import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareMatchedResources,
  evaluatePromptGroupMatch,
  evaluateResourceMatch,
  getResourceImportBatchKey
} from '../public/modules/resourceMatching.js';

const character = {
  id: 'character-nine',
  kind: 'character',
  title: '九渊',
  source: {
    importBatchId: 'batch-nine',
    fileName: 'jiuyuan.png'
  },
  collections: ['九渊原生素材'],
  payload: {
    name: '九渊',
    role: '宗门弟子',
    description: '仙侠修真世界中的宗门弟子。',
    scenario: '调查宗门秘境中的悬疑事件并继续修炼。',
    tags: ['仙侠', '悬疑']
  }
};

test('same import batch is always the highest native match', () => {
  const worldBook = {
    id: 'world-nine',
    kind: 'worldbook',
    title: '未命名世界书',
    source: { importBatchId: 'batch-nine' },
    payload: { entries: [] }
  };

  assert.equal(getResourceImportBatchKey(character), 'batch:batch-nine');
  assert.deepEqual(evaluateResourceMatch(character, worldBook), {
    score: 100,
    level: 'native',
    label: '原生匹配',
    reasons: ['与角色卡同批导入，属于角色卡原生资源'],
    conflict: false,
    native: true
  });
});

test('external worldbooks are scored from character, genre and topic evidence', () => {
  const match = evaluateResourceMatch(character, {
    id: 'world-external',
    kind: 'worldbook',
    title: '九渊的宗门秘境',
    payload: {
      entries: [{
        title: '九渊调查秘境',
        keywords: ['九渊', '宗门', '悬疑'],
        content: '仙侠修真背景下的秘境冒险与修炼规则。'
      }]
    }
  });

  assert.equal(match.score, 95);
  assert.equal(match.level, 'high');
  assert.equal(match.native, false);
  assert.match(match.reasons.join('；'), /明确关联角色.*题材一致/);
});

test('generic prompts stay usable while explicit genre conflicts are marked low', () => {
  const generic = evaluateResourceMatch(character, {
    id: 'prompt-generic',
    kind: 'prompt',
    title: '通用长篇叙事',
    payload: { content: '保持上下文连贯，避免重复。' }
  }, { kind: 'prompt' });
  const conflicting = evaluateResourceMatch(character, {
    id: 'prompt-modern',
    kind: 'prompt',
    title: '现代校园恋爱',
    payload: { content: '描写手机社交、大学校园和都市职场日常。' }
  }, { kind: 'prompt' });

  assert.equal(generic.score, 30);
  assert.equal(generic.level, 'general');
  assert.equal(conflicting.level, 'low');
  assert.equal(conflicting.conflict, true);
});

test('prompt bundles use native provenance first and otherwise aggregate active modules', () => {
  const native = evaluatePromptGroupMatch(character, {
    title: '九渊原生预设',
    resources: [{
      id: 'prompt-native',
      kind: 'prompt',
      source: { importBatchId: 'batch-nine' },
      payload: { content: '任意内容' }
    }]
  });
  const mixed = evaluatePromptGroupMatch(character, {
    title: '混合题材预设',
    resources: [
      {
        id: 'prompt-match',
        kind: 'prompt',
        title: '九渊仙侠悬疑',
        payload: { content: '宗门秘境调查、冒险与修炼。' }
      },
      {
        id: 'prompt-conflict',
        kind: 'prompt',
        title: '现代校园恋爱',
        payload: { content: '现代都市大学校园与手机社交。' }
      }
    ]
  });

  assert.equal(native.score, 100);
  assert.equal(native.level, 'native');
  assert.equal(mixed.score, 50);
  assert.equal(mixed.level, 'medium');
  assert.equal(mixed.conflict, false);
  assert.match(mixed.reasons.join('；'), /2 个启用模块综合评估.*1 个模块存在题材信号冲突/);
});

test('matched resource sorting keeps the highest score first', () => {
  const resources = [
    { title: '低', match: { score: 15 } },
    { title: '原生', match: { score: 100 } },
    { title: '中', match: { score: 55 } }
  ];

  assert.deepEqual(
    resources.sort(compareMatchedResources).map((item) => item.title),
    ['原生', '中', '低']
  );
});

test('TG V3.1.2 is the preferred classbrain fallback but never outranks native resources', () => {
  const tg = evaluatePromptGroupMatch(character, {
    title: 'TGbreak😺V3.1.2',
    resources: [{ kind: 'prompt', title: '通用约束', payload: { content: '保持上下文连贯。' } }]
  });
  const unrelated = evaluatePromptGroupMatch(character, {
    title: '其他通用预设',
    resources: [{ kind: 'prompt', title: '通用约束', payload: { content: '保持上下文连贯。' } }]
  });
  const resources = [
    { title: '其他', match: unrelated },
    { title: 'TG', match: tg },
    { title: '原生', match: { score: 100, native: true } }
  ];

  assert.equal(tg.recommended, true);
  assert.equal(tg.recommendationLabel, '类脑通用首选');
  assert.match(tg.reasons[0], /无原生预设时的默认起点/);
  assert.deepEqual(resources.sort(compareMatchedResources).map((item) => item.title), ['原生', 'TG', '其他']);
});
