import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listPromptTemplates,
  previewPromptTemplate
} from '../server/promptTemplates/promptTemplateCatalog.js';

function storyConfig(overrides = {}) {
  return {
    characterCard: {
      name: '夏瑾',
      description: '咖啡店店员',
      personality: '克制而敏锐',
      scenario: '现代都市日常'
    },
    worldBook: [
      { id: 'place', type: 'location', title: '旧街咖啡店', content: '位于旧街。' },
      { id: 'owner', type: 'character', title: '店长', content: '与夏瑾互相信任。' }
    ],
    promptModules: [{ id: 'community-base', title: '社区基础', enabled: true, content: '保留我。', extensions: { sillyTavernPreset: { presetTitle: '测试预设' } } }],
    groupMembers: [],
    lightFrontend: {},
    ...overrides
  };
}

test('template catalog ranks against the current card, world book and runtime signals', () => {
  const result = listPromptTemplates(storyConfig({
    lightFrontend: { regexTransforms: [{ id: 'status' }] }
  }), {
    title: '夏瑾 · 新卷',
    settings: { responseLength: 'long' },
    messages: [{ role: 'user', content: '你好' }]
  });

  assert.equal(result.spec, 'narrative-engine.prompt-template/v1');
  assert.equal(result.context.characterName, '夏瑾');
  assert.equal(result.context.worldBookCount, 2);
  assert.equal(result.context.communityPreset, true);
  assert.equal(result.context.lightFrontendActive, true);
  assert.ok(result.templates.find((item) => item.id === 'role-fidelity').compatibility.score >= 90);
  assert.ok(result.templates.find((item) => item.id === 'light-frontend-compat').compatibility.score >= 90);
});

test('append mode updates the same template without growing duplicate modules', () => {
  const first = previewPromptTemplate({
    templateId: 'role-fidelity',
    parameters: { strictness: 'balanced' },
    config: storyConfig()
  });
  const second = previewPromptTemplate({
    templateId: 'role-fidelity',
    parameters: { strictness: 'strict' },
    config: storyConfig({ promptModules: first.promptModules })
  });

  assert.equal(first.changes.added, 1);
  assert.equal(second.changes.added, 0);
  assert.equal(second.changes.updated, 1);
  assert.equal(second.promptModules.length, first.promptModules.length);
  assert.equal(second.promptModules.filter((module) => module.id === 'prompt-template:role-fidelity:anchor').length, 1);
  assert.match(second.promptModules.at(-1).content, /不得擅自设为既定事实/);
});

test('replace mode only replaces template-center modules and preserves community modules', () => {
  const withRole = previewPromptTemplate({
    templateId: 'role-fidelity',
    config: storyConfig()
  });
  const replaced = previewPromptTemplate({
    templateId: 'scene-progression',
    mode: 'replace',
    config: storyConfig({ promptModules: withRole.promptModules })
  });

  assert.equal(replaced.changes.removedTemplateModules, 1);
  assert.equal(replaced.promptModules.some((module) => module.id === 'community-base'), true);
  assert.equal(replaced.promptModules.some((module) => module.id === 'prompt-template:role-fidelity:anchor'), false);
  assert.equal(replaced.promptModules.some((module) => module.id === 'prompt-template:scene-progression:progression'), true);
  assert.match(replaced.warnings.join('\n'), /角色卡与社区预设模块会保留/);
});

test('invalid parameter choices fall back to declared defaults', () => {
  const result = previewPromptTemplate({
    templateId: 'scene-progression',
    parameters: { length: 'impossible', pace: 'unknown' },
    config: storyConfig()
  });

  assert.deepEqual(result.parameters, { length: 'long', pace: 'balanced' });
});
