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
