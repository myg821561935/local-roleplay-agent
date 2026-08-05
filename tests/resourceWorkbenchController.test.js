import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_IMPORT_SOURCES,
  createResourceWorkbenchController,
  filterResourceLibrary,
  normalizeResourceView,
  resourceKindLabel
} from '../public/modules/resourceWorkbench.js';

function createEventTarget(extra = {}) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    ...extra
  };
}

function createClassList() {
  const values = new Set();
  return {
    values,
    toggle(name, active) {
      if (active) values.add(name);
      else values.delete(name);
    }
  };
}

test('resource workbench normalizes views, labels kinds and filters searchable metadata', () => {
  assert.equal(normalizeResourceView('online'), 'online');
  assert.equal(normalizeResourceView('unknown'), 'library');
  assert.equal(resourceKindLabel('worldbook'), '世界书');
  assert.equal(resourceKindLabel('prompt-bundle'), 'Prompt 预设');
  assert.equal(resourceKindLabel('other'), '素材');

  const resources = [
    {
      id: 'character-1',
      kind: 'character',
      title: '江湖客',
      summary: '武侠角色',
      source: { author: '阿风', site: '本地' },
      tags: ['武侠']
    },
    {
      id: 'worldbook-1',
      kind: 'worldbook',
      title: '太虚设定',
      summary: '仙侠世界',
      source: { author: '青云', site: '社区' },
      tags: ['仙侠']
    }
  ];

  assert.deepEqual(
    filterResourceLibrary(resources, { kind: 'character' }).map((item) => item.id),
    ['character-1']
  );
  assert.deepEqual(
    filterResourceLibrary(resources, { query: '青云' }).map((item) => item.id),
    ['worldbook-1']
  );
  assert.deepEqual(
    filterResourceLibrary(resources, { query: '武侠' }).map((item) => item.id),
    ['character-1']
  );
});

test('resource workbench controller owns all resource and source event bindings', () => {
  const resourceView = createEventTarget({ dataset: { resourceView: 'library' } });
  const els = {
    sourceSearch: createEventTarget(),
    sourceQuery: createEventTarget(),
    sourceResults: createEventTarget(),
    resourceViewButtons: [resourceView],
    refreshResourceLibrary: createEventTarget(),
    resourceKindFilter: createEventTarget(),
    resourceQuery: createEventTarget(),
    resourceLibraryList: createEventTarget(),
    resourcePackForm: createEventTarget(),
    resourcePackList: createEventTarget()
  };
  const controller = createResourceWorkbenchController({ state: {}, els });

  controller.bindEvents();

  assert.equal(typeof els.sourceSearch.listeners.click, 'function');
  assert.equal(typeof els.sourceQuery.listeners.keydown, 'function');
  assert.equal(typeof els.sourceResults.listeners.click, 'function');
  assert.equal(typeof resourceView.listeners.click, 'function');
  assert.equal(typeof els.refreshResourceLibrary.listeners.click, 'function');
  assert.equal(typeof els.resourceKindFilter.listeners.change, 'function');
  assert.equal(typeof els.resourceQuery.listeners.input, 'function');
  assert.equal(typeof els.resourceLibraryList.listeners.click, 'function');
  assert.equal(typeof els.resourcePackForm.listeners.submit, 'function');
  assert.equal(typeof els.resourcePackList.listeners.click, 'function');
});

test('resource workbench refreshes all resource state through one bounded loader', async () => {
  const state = {};
  const statuses = [];
  const renderCounts = {
    contentPacks: 0,
    plugins: 0,
    adapters: 0,
    assets: 0
  };
  const globalObject = {};
  const payloads = new Map([
    ['/api/resource-library/resources', { resources: [{ id: 'r1', kind: 'character' }] }],
    ['/api/resource-library/packs', { packs: [{ id: 'p1' }] }],
    ['/api/resource-library/packs/compatibility-overview', {
      spec: 'lra.pack-compatibility-overview/v1',
      contractVersion: 2,
      summary: { total: 0, audited: 0, safeDerivative: 0, attention: 0 },
      packs: []
    }],
    ['/api/resource-library/adapters', { adapters: [{ id: 'a1' }] }],
    ['/api/content-packs', { contentPacks: [{ id: 'base' }] }],
    ['/api/plugins', { plugins: [{ id: 'plugin' }] }],
    ['/api/assets', { assets: [{ id: 'asset' }] }]
  ]);
  const refreshResourceLibrary = { disabled: false };
  const controller = createResourceWorkbenchController({
    state,
    els: {
      refreshResourceLibrary,
      resourceLibraryStatus: {}
    },
    apiRequest: async (path) => payloads.get(path),
    setStatus: (_element, text, tone) => statuses.push({ text, tone }),
    renderContentPackOptions: () => { renderCounts.contentPacks += 1; },
    renderPluginRegistry: () => { renderCounts.plugins += 1; },
    renderAdapterRegistry: () => { renderCounts.adapters += 1; },
    getAssetCenterController: () => ({
      render: () => { renderCounts.assets += 1; }
    }),
    globalObject
  });

  await controller.loadResourceLibrary({ announce: true });

  assert.deepEqual(state.resourceLibrary, [{ id: 'r1', kind: 'character' }]);
  assert.equal(state.resourcePacks[0].id, 'p1');
  assert.equal(state.resourcePacks[0].compatibilityAudit.status, 'native');
  assert.deepEqual(state.resourceAdapters, [{ id: 'a1' }]);
  assert.equal(state.contentPacks[0].id, 'base');
  assert.equal(state.contentPacks[0].compatibilityAudit.status, 'native');
  assert.equal(state.resourcePackCompatibilityOverview.contractVersion, 2);
  assert.deepEqual(state.plugins, [{ id: 'plugin' }]);
  assert.deepEqual(globalObject.__assets, [{ id: 'asset' }]);
  assert.deepEqual(renderCounts, { contentPacks: 1, plugins: 1, adapters: 1, assets: 1 });
  assert.equal(refreshResourceLibrary.disabled, false);
  assert.deepEqual(statuses.at(-1), { text: '已载入 1 份素材', tone: 'ok' });
});

test('resource workbench falls back to local source definitions and exposes source labels', async () => {
  const controller = createResourceWorkbenchController({
    state: {},
    els: {},
    apiRequest: async () => {
      throw new Error('offline');
    }
  });

  await controller.loadImportSources();

  assert.deepEqual(controller.getImportSources(), FALLBACK_IMPORT_SOURCES);
  assert.equal(controller.sourceLabel('chub'), 'Chub / CharacterHub');
  assert.equal(controller.sourceLabel('custom-source'), 'custom-source');
});

test('resource view activation keeps tab, pane and flow state synchronized', () => {
  const libraryButton = {
    dataset: { resourceView: 'library' },
    classList: createClassList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const onlineButton = {
    dataset: { resourceView: 'online' },
    classList: createClassList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const libraryPane = {
    dataset: { resourcePane: 'library' },
    classList: createClassList(),
    hidden: true
  };
  const onlinePane = {
    dataset: { resourcePane: 'online' },
    classList: createClassList(),
    hidden: true
  };
  const discoverStep = {
    dataset: { resourceFlowStep: 'discover' },
    classList: createClassList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  };
  const controller = createResourceWorkbenchController({
    state: {},
    els: {
      resourceViewButtons: [libraryButton, onlineButton],
      resourceViews: [libraryPane, onlinePane],
      resourceFlowSteps: [discoverStep]
    }
  });

  controller.activateResourceView('online');

  assert.equal(libraryButton.attributes['aria-selected'], 'false');
  assert.equal(onlineButton.attributes['aria-selected'], 'true');
  assert.equal(libraryPane.hidden, true);
  assert.equal(onlinePane.hidden, false);
  assert.equal(discoverStep.attributes['aria-current'], 'step');
});
