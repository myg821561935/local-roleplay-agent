import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeMarkdown } from '../public/markdown.js';

test('renderSafeMarkdown supports bold and italic roleplay text', () => {
  const html = renderSafeMarkdown('**拔刀**\n*他压低声音。*');

  assert.equal(html, '<strong>拔刀</strong><br><em>他压低声音。</em>');
});

test('renderSafeMarkdown escapes raw HTML before applying markdown', () => {
  const html = renderSafeMarkdown('<script>alert(1)</script> **动作**');

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<strong>动作<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
});

test('renderSafeMarkdown turns immersive destiny options into actionable buttons', () => {
  const html = renderSafeMarkdown('[天机选项：雨夜抉择]\n- 追问旧案\n· 暂避锋芒');

  assert.match(html, /<button type="button" class="immersive-option-item"/);
  assert.match(html, /data-immersive-option-action="%E8%BF%BD%E9%97%AE%E6%97%A7%E6%A1%88"/);
  assert.match(html, />追问旧案<\/button>/);
  assert.match(html, />暂避锋芒<\/button>/);
});
