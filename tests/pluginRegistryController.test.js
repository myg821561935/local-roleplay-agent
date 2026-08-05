import test from 'node:test';
import assert from 'node:assert/strict';

import { createPluginRegistryController } from '../public/modules/pluginRegistry.js';

function createNode(tagName = 'div') {
  const children = [];
  let html = '';
  return {
    tagName,
    children,
    dataset: {},
    className: '',
    textContent: '',
    disabled: false,
    append(...nodes) {
      children.push(...nodes);
    },
    set innerHTML(value) {
      html = value;
      if (value === '') children.length = 0;
    },
    get innerHTML() {
      return html;
    }
  };
}

function createEventTarget() {
  const listeners = {};
  return {
    ...createNode(),
    listeners,
    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  };
}

test('plugin registry controller renders plugin status, local actions and adapter metadata', () => {
  const pluginList = createEventTarget();
  const adapterList = createNode();
  const pluginSummary = {};
  const adapterCount = {};
  const state = {
    plugins: [
      {
        id: 'core.import',
        name: '内置导入器',
        origin: 'core',
        enabled: true,
        compatible: true,
        runtime: 'declarative',
        version: '1.2.0',
        adapterCount: 1,
        capabilityCount: 2
      },
      {
        id: 'local.card',
        name: '本地角色卡',
        origin: 'local',
        enabled: false,
        compatible: true,
        runtime: 'declarative',
        version: '0.3.0',
        adapterCount: 2,
        capabilityCount: 1
      }
    ],
    resourceAdapters: [
      {
        id: 'character-card-v2',
        label: 'Character Card V2',
        kinds: ['character'],
        formats: ['png', 'json'],
        pluginName: '本地角色卡',
        version: '0.3.0'
      }
    ]
  };
  const controller = createPluginRegistryController({
    state,
    els: { pluginList, pluginSummary, adapterList, adapterCount },
    documentObject: { createElement: createNode }
  });

  controller.renderPluginRegistry();
  controller.renderAdapterRegistry();

  assert.equal(pluginSummary.textContent, '2 个插件 · 1 个可用 · 1 个本地安装');
  assert.equal(pluginList.children.length, 2);
  assert.equal(pluginList.children[0].children[1].children[0].textContent, '随引擎提供');
  const localActions = pluginList.children[1].children[1].children;
  assert.equal(localActions[0].dataset.pluginToggle, 'local.card');
  assert.equal(localActions[0].textContent, '启用');
  assert.equal(localActions[1].dataset.pluginDelete, 'local.card');
  assert.equal(adapterCount.textContent, '1 个');
  assert.equal(adapterList.children[0].children[0].children[0].textContent, 'Character Card V2');
  assert.match(adapterList.children[0].children[0].children[1].textContent, /character · png, json · 本地角色卡/);
});

test('plugin registry controller owns toggle events and refreshes shared resource state', async () => {
  const pluginList = createEventTarget();
  const apiCalls = [];
  const statuses = [];
  let refreshCount = 0;
  const controller = createPluginRegistryController({
    state: {
      plugins: [{
        id: 'local.card',
        name: '本地角色卡',
        origin: 'local',
        enabled: true,
        compatible: true
      }]
    },
    els: { pluginList, resourceLibraryStatus: {} },
    apiRequest: async (path, options) => {
      apiCalls.push({ path, options });
    },
    refreshRegistry: async () => {
      refreshCount += 1;
    },
    setStatus: (_element, text, tone) => statuses.push({ text, tone })
  });
  controller.bindEvents();
  const toggleButton = {
    dataset: { pluginToggle: 'local.card' },
    disabled: false,
    closest(selector) {
      return selector === '[data-plugin-toggle]' ? this : null;
    }
  };

  await pluginList.listeners.click({ target: toggleButton });

  assert.deepEqual(apiCalls, [{
    path: '/api/plugins/local.card',
    options: { method: 'PATCH', body: { enabled: false } }
  }]);
  assert.equal(refreshCount, 1);
  assert.equal(toggleButton.disabled, true);
  assert.deepEqual(statuses.at(-1), { text: '扩展已停用：本地角色卡', tone: 'ok' });
});

test('plugin registry controller requires confirmation before removing a local plugin', async () => {
  const pluginList = createEventTarget();
  let apiCallCount = 0;
  const controller = createPluginRegistryController({
    state: {
      plugins: [{
        id: 'local.card',
        name: '本地角色卡',
        origin: 'local',
        enabled: true,
        compatible: true
      }]
    },
    els: { pluginList },
    apiRequest: async () => {
      apiCallCount += 1;
    },
    confirmAction: () => false
  });
  controller.bindEvents();
  const deleteButton = {
    dataset: { pluginDelete: 'local.card' },
    disabled: false,
    closest(selector) {
      return selector === '[data-plugin-delete]' ? this : null;
    }
  };

  await pluginList.listeners.click({ target: deleteButton });

  assert.equal(apiCallCount, 0);
  assert.equal(deleteButton.disabled, false);
});
