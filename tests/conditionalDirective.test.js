import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractConditionalDirective,
  evaluateCondition,
  applyConditionalDirectives
} from '../server/compat/conditionalDirective.js';

test('extractConditionalDirective parses @@if with --- separator', () => {
  const result = extractConditionalDirective('@@if player_city === \'白鹿原\'\n---\n白鹿原的描述内容');
  assert.equal(result.condition, "player_city === '白鹿原'");
  assert.equal(result.body, '白鹿原的描述内容');
});

test('extractConditionalDirective returns null for non-@@if content', () => {
  assert.equal(extractConditionalDirective('普通世界书内容'), null);
  assert.equal(extractConditionalDirective(''), null);
});

test('extractConditionalDirective handles content without --- separator', () => {
  const result = extractConditionalDirective("@@if player_city === '天京'\n天京内容");
  assert.equal(result.condition, "player_city === '天京'");
  assert.equal(result.body, '天京内容');
});

test('evaluateCondition matches string equality', () => {
  assert.equal(evaluateCondition("player_city === '白鹿原'", { player_city: '白鹿原' }), true);
  assert.equal(evaluateCondition("player_city === '白鹿原'", { player_city: '盐坟镇' }), false);
});

test('evaluateCondition supports || operator', () => {
  assert.equal(
    evaluateCondition("current_region?.includes('天京') || player_city === '天京'", {
      current_region: '天京周边',
      player_city: '其他'
    }),
    true
  );
  assert.equal(
    evaluateCondition("current_region?.includes('天京') || player_city === '天京'", {
      current_region: '其他',
      player_city: '天京'
    }),
    true
  );
  assert.equal(
    evaluateCondition("current_region?.includes('天京') || player_city === '天京'", {
      current_region: '其他',
      player_city: '其他'
    }),
    false
  );
});

test('evaluateCondition supports player_faction', () => {
  assert.equal(
    evaluateCondition("player_faction === '西戈'", { player_faction: '西戈' }),
    true
  );
  assert.equal(
    evaluateCondition("player_faction === '西戈'", { player_faction: '大朔' }),
    false
  );
});

test('evaluateCondition returns false for missing variables', () => {
  assert.equal(evaluateCondition("player_city === '白鹿原'", {}), false);
  assert.equal(evaluateCondition("unknown_var === 'x'", {}), false);
});

test('evaluateCondition blocks dangerous expressions', () => {
  assert.equal(evaluateCondition('globalThis', {}), false);
  assert.equal(evaluateCondition('process.exit()', {}), false);
  assert.equal(evaluateCondition('require("fs")', {}), false);
  assert.equal(evaluateCondition('eval("1+1")', {}), false);
  assert.equal(evaluateCondition('new Function("return 1")()', {}), false);
});

test('applyConditionalDirectives filters entries by condition', () => {
  const entries = [
    { id: '1', title: '白鹿原', content: "@@if player_city === '白鹿原'\n---\n白鹿原详情" },
    { id: '2', title: '盐坟镇', content: "@@if player_city === '盐坟镇'\n---\n盐坟镇详情" },
    { id: '3', title: '常驻', content: '常驻内容无条件' }
  ];
  const result = applyConditionalDirectives(entries, { values: { player_city: '白鹿原' } });
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.entries[0].title, '白鹿原');
  assert.equal(result.entries[0].content, '白鹿原详情');
  assert.equal(result.entries[1].title, '常驻');
  assert.equal(result.skipped[0].title, '盐坟镇');
});

test('applyConditionalDirectives handles empty state', () => {
  const entries = [
    { id: '1', title: '条件条目', content: "@@if player_city === '白鹿原'\n---\n内容" },
    { id: '2', title: '无条件', content: '普通内容' }
  ];
  const result = applyConditionalDirectives(entries, {});
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].title, '无条件');
  assert.equal(result.skipped.length, 1);
});

test('applyConditionalDirectives preserves entry metadata', () => {
  const entries = [
    {
      id: '1',
      title: '白鹿原',
      content: "@@if player_city === '白鹿原'\n---\n白鹿原详情",
      keywords: ['白鹿原'],
      constant: false,
      depth: 4,
      enabled: true
    }
  ];
  const result = applyConditionalDirectives(entries, { values: { player_city: '白鹿原' } });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].content, '白鹿原详情');
  assert.equal(result.entries[0].keywords[0], '白鹿原');
  assert.equal(result.entries[0].depth, 4);
  assert.equal(result.entries[0].enabled, true);
});
