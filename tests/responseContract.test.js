import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResponseContractPrompt,
  normalizeResponseLengthMode
} from '../server/agent/responseContract.js';

test('response contract defaults to a complete standard scene unit', () => {
  const prompt = buildResponseContractPrompt('unexpected');

  assert.equal(normalizeResponseLengthMode('unexpected'), 'balanced');
  assert.match(prompt, /标准推进/);
  assert.match(prompt, /1200-2000 个中文字符/);
  assert.match(prompt, /不要停在动作刚开始/);
  assert.match(prompt, /至少 2 项可见变化/);
});

test('long response contract raises scene progress without taking over player decisions', () => {
  const prompt = buildResponseContractPrompt('long');

  assert.match(prompt, /2000-3200 个中文字符/);
  assert.match(prompt, /3-5 个相互承接的场景节拍/);
  assert.match(prompt, /不得替玩家决定重大选择/);
});
