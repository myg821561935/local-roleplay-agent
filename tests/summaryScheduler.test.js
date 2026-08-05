import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryPrompt, parseSummaryResult } from '../server/agent/summaryScheduler.js';

test('summary prompt requests separate rolling and scene memories without CoT', () => {
  const prompt = buildSummaryPrompt({
    rollingSummary: '旧摘要。',
    messages: [
      { role: 'user', content: '调查卷宗。' },
      { role: 'assistant', content: '发现名单。' }
    ],
    canonicalContext: '角色卡：闻雪照'
  });

  assert.match(prompt[0].content, /rollingSummary/);
  assert.match(prompt[0].content, /sceneSummary/);
  assert.match(prompt[0].content, /不要输出.*思维链/);
  assert.match(prompt[1].content, /角色卡：闻雪照/);
});

test('parseSummaryResult accepts structured JSON and strips hidden reasoning', () => {
  const result = parseSummaryResult(JSON.stringify({
    rollingSummary: '<think>内部推演</think>主角继续调查旧案。',
    sceneTitle: '卷宗名单',
    sceneSummary: '闻雪照找到了失踪者名单。'
  }));

  assert.equal(result.structured, true);
  assert.equal(result.rollingSummary, '主角继续调查旧案。');
  assert.equal(result.sceneTitle, '卷宗名单');
  assert.equal(result.sceneSummary, '闻雪照找到了失踪者名单。');
});

test('parseSummaryResult keeps plain-text providers backward compatible', () => {
  const result = parseSummaryResult('旧版 Provider 返回的滚动摘要。');

  assert.equal(result.structured, false);
  assert.equal(result.rollingSummary, '旧版 Provider 返回的滚动摘要。');
  assert.equal(result.sceneSummary, '');
});
