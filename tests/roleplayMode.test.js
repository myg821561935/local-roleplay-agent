import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoleplayModePrompt,
  normalizeRoleplayMode
} from '../server/agent/roleplayMode.js';

test('roleplay mode defaults to standard DM without replacing narrative constraints', () => {
  assert.equal(normalizeRoleplayMode('unknown'), 'dm');
  const prompt = buildRoleplayModePrompt();
  assert.match(prompt, /标准 DM 叙事流/);
  assert.match(prompt, /用户控制自己的角色/);
  assert.match(prompt, /不改变当前角色卡、世界书、预设和主线约束/);
});

test('the five native roleplay modes keep distinct agency boundaries', () => {
  assert.match(buildRoleplayModePrompt('dialogue'), /对白流/);
  assert.match(buildRoleplayModePrompt('protagonist'), /低风险动作/);
  assert.match(buildRoleplayModePrompt('director'), /共同创作者/);
  assert.match(buildRoleplayModePrompt('commentary'), /旁白解说流/);
});
