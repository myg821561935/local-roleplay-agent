import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateResourceEvaluations,
  estimateResourceTokens,
  evaluateResourceCandidate
} from '../server/resources/resourceEvaluator.js';

test('resource evaluator produces a readable five-dimension character assessment', () => {
  const diagnostics = evaluateResourceCandidate({
    kind: 'character',
    payload: {
      name: '沈观澜',
      description: '背负旧案的年轻刀客，在各方势力之间追查一封失踪的供词。',
      personality: '克制，重诺，擅长从沉默和细节中判断他人。',
      scenario: '雨夜进入听雨楼，与掌柜第一次试探。',
      firstMessage: '檐下的雨，像一场没有写完的供词。',
      exampleDialog: ['用户：你来找谁？', '沈观澜：找一个不该死的人。'],
      systemPrompt: '保持武侠悬案边界，不替用户决定核心选择。'
    }
  }, {
    source: { site: '类脑社区', author: '测试作者', fileName: 'shen.json', version: '2.0' },
    adapter: { id: 'character-card-v2' }
  });

  assert.equal(diagnostics.dimensions.length, 5);
  assert.equal(diagnostics.verdict, 'recommended');
  assert.equal(diagnostics.canImport, true);
  assert.ok(diagnostics.estimatedTokens > 0);
  assert.ok(diagnostics.dimensions.find((item) => item.id === 'activation'));
});

test('resource evaluator identifies inert lore, overlapping triggers and invalid regex', () => {
  const diagnostics = evaluateResourceCandidate({
    kind: 'worldbook',
    payload: {
      entries: [
        { title: '听雨楼', content: '消息交易之地。', keywords: ['听雨楼'], regex: ['['], enabled: true },
        { title: '听雨楼', content: '楼中规矩。', keywords: ['听雨楼'], enabled: true },
        { title: '无触发条目', content: '不会主动出现。', keywords: [], regex: [], constant: false, enabled: true }
      ]
    }
  }, {
    source: { site: 'local-file', fileName: 'lore.json' },
    adapter: { id: 'sillytavern-worldbook' }
  });

  const codes = diagnostics.warnings.map((item) => item.code);
  assert.ok(codes.includes('WORLD_BOOK_INERT_ENTRIES'));
  assert.ok(codes.includes('WORLD_BOOK_DUPLICATE_TITLES'));
  assert.ok(codes.includes('WORLD_BOOK_OVERLAPPING_TRIGGERS'));
  assert.ok(codes.includes('WORLD_BOOK_INVALID_REGEX'));
  assert.equal(diagnostics.stats.invalidRegexCount, 1);
  assert.ok(diagnostics.score < 90);
});

test('resource evaluator blocks empty prompt resources and aggregates the decision', () => {
  const diagnostics = evaluateResourceCandidate({
    kind: 'prompt',
    payload: { title: '空提示词', content: '' }
  });
  const evaluation = aggregateResourceEvaluations([diagnostics]);

  assert.equal(diagnostics.verdict, 'blocked');
  assert.equal(diagnostics.canImport, false);
  assert.equal(evaluation.verdict, 'blocked');
  assert.equal(evaluation.canImport, false);
  assert.equal(evaluation.blockingCount, 1);
  assert.equal(estimateResourceTokens({ content: '一段用于测试的中文提示词。' }) > 0, true);
});
