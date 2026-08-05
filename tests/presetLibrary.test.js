import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collapsePromptResourcesForDisplay,
  collectSelectedPromptResourceIds,
  groupPromptResources
} from '../public/modules/presetLibrary.js';

test('groups imported prompt modules as one selectable preset bundle', () => {
  const resources = [
    createPromptResource('preset-main', '主提示', {
      presetTitle: '社区长篇预设',
      enabled: true,
      score: 84,
      tokens: 120,
      importBatchId: 'batch-1'
    }),
    createPromptResource('preset-history', '历史约束', {
      presetTitle: '社区长篇预设',
      enabled: false,
      score: 90,
      tokens: 80,
      importBatchId: 'batch-1'
    }),
    createPromptResource('preset-regex', '社区长篇预设 Regex 配套规则', {
      presetTitle: '社区长篇预设',
      enabled: false,
      score: 66,
      tokens: 200,
      importBatchId: 'batch-1',
      runtimeCompanion: { kind: 'regex', ruleCount: 14 }
    }),
    createPromptResource('standalone', '独立提示', {
      score: 70,
      tokens: 20
    })
  ];

  const groups = groupPromptResources(resources);
  assert.equal(groups.length, 2);

  const preset = groups.find((group) => group.title === '社区长篇预设');
  assert.deepEqual(preset.resourceIds, ['preset-main', 'preset-history', 'preset-regex']);
  assert.equal(preset.moduleCount, 2);
  assert.equal(preset.enabledCount, 1);
  assert.equal(preset.estimatedTokens, 200);
  assert.equal(preset.score, 87);
  assert.equal(preset.runtimeCount, 1);
  assert.equal(preset.regexRuleCount, 14);
  assert.equal(preset.isPresetBundle, true);

  const standalone = groups.find((group) => group.title === '独立提示');
  assert.deepEqual(standalone.resourceIds, ['standalone']);
  assert.equal(standalone.isPresetBundle, false);
});

test('expands selected preset bundles back to prompt resource ids', () => {
  const container = {
    querySelectorAll() {
      return [
        {
          dataset: { resourceIds: JSON.stringify(['preset-main', 'preset-history']) },
          value: 'preset-main'
        },
        {
          dataset: {},
          value: 'standalone'
        }
      ];
    }
  };

  assert.deepEqual(
    collectSelectedPromptResourceIds(container),
    ['preset-main', 'preset-history', 'standalone']
  );
});

test('keeps a stored prompt bundle as one asset and collapses legacy module batches for display', () => {
  const storedBundle = {
    id: 'bundle-1',
    kind: 'prompt-bundle',
    title: '夏瑾预设',
    diagnostics: { score: 82, estimatedTokens: 900 },
    payload: {
      title: '夏瑾预设',
      sourceFormat: 'sillytavern-preset',
      promptModules: [
        { id: 'main', title: '主提示', content: '主提示内容', enabled: true },
        { id: 'disabled', title: '停用提示', content: '停用内容', enabled: false },
        { id: 'regex', title: 'Regex', content: '规则', enabled: false, extensions: { sillyTavernRuntimeCompanion: { ruleCount: 4 } } }
      ]
    }
  };
  const group = groupPromptResources([storedBundle])[0];
  assert.deepEqual(group.resourceIds, ['bundle-1']);
  assert.equal(group.moduleCount, 2);
  assert.equal(group.enabledCount, 1);
  assert.equal(group.runtimeCount, 1);
  assert.equal(group.regexRuleCount, 4);
  assert.equal(collapsePromptResourcesForDisplay([storedBundle])[0], storedBundle);

  const disabledBundle = structuredClone(storedBundle);
  disabledBundle.id = 'bundle-disabled';
  disabledBundle.payload.promptModules.forEach((module) => { module.enabled = false; });
  assert.equal(groupPromptResources([disabledBundle])[0].estimatedTokens, 0);

  const legacy = [
    createPromptResource('legacy-a', '模块 A', { presetTitle: '旧预设', importBatchId: 'legacy-batch' }),
    createPromptResource('legacy-b', '模块 B', { presetTitle: '旧预设', importBatchId: 'legacy-batch' })
  ];
  const collapsed = collapsePromptResourcesForDisplay(legacy);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].kind, 'prompt-bundle');
  assert.deepEqual(collapsed[0].resourceIds, ['legacy-a', 'legacy-b']);
  assert.equal(collapsed[0].payload.promptModules.length, 2);
});

function createPromptResource(id, title, {
  presetTitle = '',
  enabled = true,
  score = 0,
  tokens = 0,
  importBatchId = '',
  runtimeCompanion = null
} = {}) {
  return {
    id,
    kind: 'prompt',
    title,
    source: {
      site: '类脑社区',
      importBatchId
    },
    diagnostics: {
      score,
      estimatedTokens: tokens
    },
    payload: {
      title,
      enabled,
      extensions: presetTitle || runtimeCompanion
        ? {
          sillyTavernPreset: {
            presetTitle,
            sourceFormat: 'sillytavern-preset'
          },
          ...(runtimeCompanion ? { sillyTavernRuntimeCompanion: runtimeCompanion } : {})
        }
        : {}
    }
  };
}
