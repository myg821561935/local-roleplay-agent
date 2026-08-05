import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPresetWorkspaceController,
  parsePromptDraft
} from '../public/modules/presetWorkspace.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this, ...event });
    }
  }
}

const documentObject = {
  createElement: (tagName) => new FakeElement(tagName)
};

function createElements() {
  return {
    promptEditor: new FakeElement('textarea'),
    promptStatus: new FakeElement(),
    promptPresetFavorites: new FakeElement('select'),
    applySavedPromptPreset: new FakeElement('button'),
    savePromptPreset: new FakeElement('button'),
    deletePromptPreset: new FakeElement('button'),
    savePrompt: new FakeElement('button'),
    promptPresetSelect: new FakeElement('select'),
    applyPromptPreset: new FakeElement('button'),
    worldbookPresetSelect: new FakeElement('select'),
    applyWorldbookPreset: new FakeElement('button'),
    worldbookStatus: new FakeElement()
  };
}

function createHarness(overrides = {}) {
  const els = overrides.els || createElements();
  const state = overrides.state || {
    config: {
      promptModules: [{ id: 'state-prompt' }],
      promptPresets: [{
        id: 'favorite-a',
        name: '<img onerror=alert(1)>',
        promptModules: [{ id: 'favorite-prompt' }]
      }]
    }
  };
  const statuses = [];
  const worldbookDrafts = [];
  let sessionId = 'session/a';
  const controller = createPresetWorkspaceController({
    state,
    els,
    apiRequest: overrides.apiRequest,
    getCurrentSessionId: () => sessionId,
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    humanizeApiError: (error) => `友好：${error.message}`,
    prettyJson: (value) => JSON.stringify(value),
    getResources: overrides.getResources || (() => state.resourceLibrary || []),
    setWorldbookDraft: (entries) => {
      worldbookDrafts.push(entries);
      return true;
    },
    confirmAction: overrides.confirmAction ?? (() => true),
    promptAction: overrides.promptAction ?? (() => '我的预设'),
    documentObject
  });
  return {
    controller,
    els,
    state,
    statuses,
    worldbookDrafts,
    setSessionId: (value) => {
      sessionId = value;
    }
  };
}

test('prompt parser only accepts JSON arrays', () => {
  assert.deepEqual(parsePromptDraft(''), []);
  assert.deepEqual(parsePromptDraft('[{"id":"draft"}]'), [{ id: 'draft' }]);
  assert.equal(parsePromptDraft('{"id":"object"}'), null);
  assert.equal(parsePromptDraft('{bad'), null);
});

test('favorite rendering preserves valid selection and renders third-party names as text', () => {
  const harness = createHarness();
  harness.els.promptPresetFavorites.value = 'favorite-a';

  harness.controller.renderPromptPresetFavorites();

  assert.equal(harness.els.promptPresetFavorites.children.length, 2);
  assert.equal(harness.els.promptPresetFavorites.children[0].textContent, '-- 我的预设 --');
  assert.equal(harness.els.promptPresetFavorites.children[1].textContent, '<img onerror=alert(1)>');
  assert.equal(harness.els.promptPresetFavorites.value, 'favorite-a');

  harness.state.config.promptPresets = [];
  harness.controller.renderPromptPresetFavorites();
  assert.equal(harness.els.promptPresetFavorites.value, '');
});

test('saving a favorite uses the unsaved editor draft and rejects non-array JSON', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return {
        promptPresets: [{
          id: 'favorite-new',
          name: '我的预设',
          promptModules: options.body.promptModules
        }],
        preset: { id: 'favorite-new', name: '我的预设' }
      };
    }
  });
  harness.els.promptEditor.value = '[{"id":"draft"}]';

  const saved = await harness.controller.savePromptPresetFavorite();

  assert.equal(saved.id, 'favorite-new');
  assert.deepEqual(calls, [[
    '/api/prompt-presets',
    {
      method: 'POST',
      body: {
        name: '我的预设',
        promptModules: [{ id: 'draft' }]
      }
    }
  ]]);
  assert.equal(harness.els.promptPresetFavorites.value, 'favorite-new');
  assert.equal(harness.els.savePromptPreset.disabled, false);

  harness.els.promptEditor.value = '{"id":"not-array"}';
  assert.equal(await harness.controller.savePromptPresetFavorite(), null);
  assert.equal(calls.length, 1);
  assert.match(harness.statuses.at(-1)[0], /必须是有效的 JSON 数组/);
});

test('applying a saved preset is session scoped and clears the prompt draft dirty state', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return {
        promptModules: [{ id: 'normalized' }],
        promptPresets: []
      };
    }
  });
  harness.els.promptPresetFavorites.value = 'favorite-a';
  harness.els.promptEditor.value = '[{"id":"unsaved"}]';
  harness.controller.bindEvents();
  harness.els.promptEditor.dispatch('input');

  const applied = await harness.controller.applySavedPromptPreset();

  assert.deepEqual(applied, [{ id: 'normalized' }]);
  assert.deepEqual(calls[0], [
    '/api/prompt-presets/apply',
    {
      method: 'POST',
      body: {
        id: 'favorite-a',
        sessionId: 'session/a'
      }
    }
  ]);
  assert.deepEqual(harness.state.config.promptModules, [{ id: 'normalized' }]);
  assert.equal(harness.els.promptEditor.value, '[{"id":"normalized"}]');

  harness.state.config.promptModules = [{ id: 'server-refresh' }];
  assert.equal(harness.controller.renderPromptEditor(), true);
  assert.equal(harness.els.promptEditor.value, '[{"id":"server-refresh"}]');
});

test('built-in presets remain unsaved drafts across inspector redraws but not session switches', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.renderPromptEditor();
  harness.els.promptPresetSelect.value = 'wuxia';

  assert.equal(harness.controller.applyPromptPreset(), true);
  assert.match(harness.els.promptEditor.value, /专业的武侠角色扮演引擎/);
  harness.state.config.promptModules = [{ id: 'server-copy' }];
  assert.equal(harness.controller.renderPromptEditor(), false);
  assert.match(harness.els.promptEditor.value, /专业的武侠角色扮演引擎/);

  harness.els.worldbookPresetSelect.value = 'lingyi';
  assert.equal(harness.controller.applyWorldbookPreset(), true);
  assert.equal(harness.worldbookDrafts.length, 1);
  assert.equal(harness.worldbookDrafts[0][0].id, 'concept-shaqi');

  harness.setSessionId('session/b');
  assert.equal(harness.controller.renderPromptEditor(), true);
  assert.equal(harness.els.promptEditor.value, '[{"id":"server-copy"}]');
});

test('imported world books and prompt batches appear in content-setting selectors', () => {
  const state = {
    config: { promptModules: [], promptPresets: [] },
    resourceLibrary: [
      {
        id: 'prompt-later',
        kind: 'prompt',
        title: '后置规则',
        collections: ['夏瑾预设'],
        source: { importBatchId: 'batch-xiajin' },
        payload: {
          id: 'later',
          content: '后置',
          extensions: { sillyTavernPreset: { sequence: 1 } }
        }
      },
      {
        id: 'prompt-first',
        kind: 'prompt',
        title: '主规则',
        collections: ['夏瑾预设'],
        source: { importBatchId: 'batch-xiajin' },
        payload: {
          id: 'first',
          content: '主规则',
          extensions: { sillyTavernPreset: { sequence: 0 } }
        }
      },
      {
        id: 'prompt-bundle-xiajin',
        kind: 'prompt-bundle',
        title: '夏瑾新版',
        payload: {
          title: '夏瑾新版',
          promptModules: [
            { id: 'bundle-first', content: '包内主规则' },
            { id: 'bundle-later', content: '包内后置' }
          ]
        }
      },
      {
        id: 'world-maid',
        kind: 'worldbook',
        title: '女仆之家设定集',
        payload: { entries: [{ id: 'maid-rule', title: '宅邸规则' }] }
      }
    ]
  };
  const harness = createHarness({ state });

  harness.controller.renderPromptPresetFavorites();
  harness.els.promptPresetSelect.value = 'resource-prompt-batch:batch-xiajin';
  harness.els.worldbookPresetSelect.value = 'resource-worldbook:world-maid';
  harness.controller.renderPromptPresetFavorites();

  const promptGroups = harness.els.promptPresetSelect.children
    .filter((child) => child.id === 'resource-library-prompt-group');
  const worldbookGroups = harness.els.worldbookPresetSelect.children
    .filter((child) => child.id === 'resource-library-worldbook-group');
  assert.equal(promptGroups.length, 1);
  assert.equal(promptGroups[0].children.length, 2);
  assert.equal(worldbookGroups.length, 1);
  assert.equal(harness.els.promptPresetSelect.value, 'resource-prompt-batch:batch-xiajin');
  assert.equal(harness.els.worldbookPresetSelect.value, 'resource-worldbook:world-maid');
  assert.equal(promptGroups[0].children[0].textContent, '夏瑾预设（2 模块）');
  assert.equal(promptGroups[0].children[1].textContent, '夏瑾新版（2 模块）');
  assert.equal(worldbookGroups[0].children[0].textContent, '女仆之家设定集（1 条）');

  assert.equal(harness.controller.applyPromptPreset(), true);
  assert.deepEqual(JSON.parse(harness.els.promptEditor.value).map((item) => item.id), ['first', 'later']);

  harness.els.promptPresetSelect.value = 'resource-prompt-batch:bundle-prompt-bundle-xiajin';
  assert.equal(harness.controller.applyPromptPreset(), true);
  assert.deepEqual(JSON.parse(harness.els.promptEditor.value).map((item) => item.id), ['bundle-first', 'bundle-later']);

  assert.equal(harness.controller.applyWorldbookPreset(), true);
  assert.equal(harness.worldbookDrafts.at(-1)[0].id, 'maid-rule');
  assert.match(harness.statuses.at(-1)[0], /资源库世界书：女仆之家设定集/);
});

test('saving prompt modules uses the current session and server-normalized response', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return { promptModules: [{ id: 'normalized' }] };
    }
  });
  harness.els.promptEditor.value = '[{"id":"draft"}]';

  const saved = await harness.controller.savePromptModules();

  assert.deepEqual(saved, [{ id: 'normalized' }]);
  assert.deepEqual(calls, [[
    '/api/prompt-modules',
    {
      method: 'PUT',
      body: {
        sessionId: 'session/a',
        promptModules: [{ id: 'draft' }]
      }
    }
  ]]);
  assert.equal(harness.els.promptEditor.value, '[{"id":"normalized"}]');
  assert.equal(harness.els.savePrompt.disabled, false);
});

test('deleting a favorite updates the list and event binding is idempotent', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return { promptPresets: [] };
    }
  });
  harness.els.promptPresetFavorites.value = 'favorite-a';

  assert.deepEqual(await harness.controller.deletePromptPresetFavorite(), []);
  assert.equal(harness.els.promptPresetFavorites.value, '');
  assert.deepEqual(calls[0], [
    '/api/prompt-presets',
    { method: 'DELETE', body: { id: 'favorite-a' } }
  ]);

  harness.controller.bindEvents();
  harness.controller.bindEvents();
  for (const [element, type] of [
    [harness.els.promptEditor, 'input'],
    [harness.els.applySavedPromptPreset, 'click'],
    [harness.els.savePromptPreset, 'click'],
    [harness.els.deletePromptPreset, 'click'],
    [harness.els.savePrompt, 'click'],
    [harness.els.applyPromptPreset, 'click'],
    [harness.els.applyWorldbookPreset, 'click']
  ]) {
    assert.equal(element.listeners.get(type).length, 1);
  }
});
