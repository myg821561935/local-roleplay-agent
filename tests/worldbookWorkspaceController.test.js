import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorldbookWorkspaceController,
  parseWorldBookDraft,
  parseWorldBookImportPayload
} from '../public/modules/worldbookWorkspace.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.classList = new FakeClassList();
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.files = [];
    this.clickCount = 0;
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
    (this.listeners.get(type) || []).forEach((listener) => listener({
      target: this,
      ...event
    }));
  }

  click() {
    this.clickCount += 1;
    this.dispatch('click');
  }
}

const documentObject = {
  createElement: (tagName) => new FakeElement(tagName)
};

function createElements() {
  return {
    saveWorldbook: new FakeElement('button'),
    addWorldbookEntry: new FakeElement('button'),
    worldbookEditor: new FakeElement('textarea'),
    worldbookStatus: new FakeElement(),
    worldbookSearch: new FakeElement('input'),
    worldbookTypeFilter: new FakeElement('select'),
    exportWorldbook: new FakeElement('button'),
    importWorldbook: new FakeElement('button'),
    worldbookImportFile: new FakeElement('input'),
    worldbookTriggerInput: new FakeElement('input'),
    worldbookTriggerResult: new FakeElement(),
    worldbookTriggerTest: new FakeElement('button'),
    worldbookTriggerClear: new FakeElement('button')
  };
}

function createHarness(overrides = {}) {
  const els = overrides.els || createElements();
  const state = overrides.state || { config: { worldBook: [{ id: 'state-entry' }] } };
  const statuses = [];
  let renderCount = 0;
  let editorCallback = null;
  let editorTemplate = null;
  let sessionId = 'session/a';
  const worldbookController = overrides.worldbookController || {
    renderWorldbookEntries: () => {
      renderCount += 1;
    },
    openWorldbookEntryEditor: (template, callback) => {
      editorTemplate = template;
      editorCallback = callback;
    }
  };
  const controller = createWorldbookWorkspaceController({
    state,
    els,
    apiRequest: overrides.apiRequest,
    getCurrentSessionId: () => sessionId,
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    humanizeApiError: (error) => `友好：${error.message}`,
    prettyJson: (value) => JSON.stringify(value),
    createEntryTemplate: () => ({ id: 'template' }),
    worldbookController,
    confirmAction: overrides.confirmAction,
    downloadJsonFile: overrides.downloadJsonFile,
    documentObject,
    now: () => new Date('2026-07-31T12:00:00.000Z')
  });
  return {
    controller,
    els,
    state,
    statuses,
    getRenderCount: () => renderCount,
    getEditorCallback: () => editorCallback,
    getEditorTemplate: () => editorTemplate,
    setSessionId: (value) => {
      sessionId = value;
    }
  };
}

test('worldbook parsers distinguish valid drafts and supported import envelopes', () => {
  assert.deepEqual(parseWorldBookDraft('', [{ id: 'fallback' }]), [{ id: 'fallback' }]);
  assert.deepEqual(parseWorldBookDraft('[{"id":"draft"}]', []), [{ id: 'draft' }]);
  assert.equal(parseWorldBookDraft('{"id":"not-array"}', []), null);
  assert.equal(parseWorldBookDraft('{bad', []), null);
  assert.deepEqual(parseWorldBookImportPayload([{ id: 'array' }]), [{ id: 'array' }]);
  assert.deepEqual(parseWorldBookImportPayload({ entries: [{ id: 'envelope' }] }), [{ id: 'envelope' }]);
  assert.equal(parseWorldBookImportPayload({ entries: {} }), null);
});

test('worldbook save uses the editor draft, session contract, and server-normalized result', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return { worldBook: [{ id: 'normalized' }] };
    }
  });
  harness.els.worldbookEditor.value = '[{"id":"draft"}]';

  const result = await harness.controller.saveWorldBook();

  assert.deepEqual(calls, [[
    '/api/world-book',
    {
      method: 'PUT',
      body: {
        sessionId: 'session/a',
        worldBook: [{ id: 'draft' }]
      }
    }
  ]]);
  assert.deepEqual(result, [{ id: 'normalized' }]);
  assert.deepEqual(harness.state.config.worldBook, [{ id: 'normalized' }]);
  assert.equal(harness.els.worldbookEditor.value, '[{"id":"normalized"}]');
  assert.equal(harness.getRenderCount(), 1);
  assert.equal(harness.els.saveWorldbook.disabled, false);
  assert.deepEqual(harness.statuses, [
    ['正在保存...', 'busy'],
    ['世界书已保存', 'ok']
  ]);
});

test('invalid editor JSON blocks save and add instead of silently using stale state', async () => {
  let apiCalls = 0;
  const harness = createHarness({
    apiRequest: async () => {
      apiCalls += 1;
      return {};
    }
  });
  harness.els.worldbookEditor.value = '{bad';

  assert.equal(await harness.controller.saveWorldBook(), null);
  assert.equal(harness.controller.addWorldBookEntry(), false);
  assert.equal(apiCalls, 0);
  assert.equal(harness.getEditorTemplate(), null);
  assert.deepEqual(harness.state.config.worldBook, [{ id: 'state-entry' }]);
  assert.match(harness.statuses[1][0], /必须是有效数组/);
  assert.match(harness.statuses[2][0], /无法新增/);
});

test('adding an entry preserves unsaved draft entries and delegates editing', () => {
  const harness = createHarness();
  harness.els.worldbookEditor.value = '[{"id":"draft"}]';

  assert.equal(harness.controller.addWorldBookEntry(), true);
  assert.deepEqual(harness.getEditorTemplate(), { id: 'template' });
  harness.getEditorCallback()({ id: 'created' });

  assert.deepEqual(harness.state.config.worldBook, [{ id: 'draft' }, { id: 'created' }]);
  assert.equal(harness.getRenderCount(), 1);
  assert.match(harness.statuses[0][0], /已添加条目/);
});

test('trigger testing uses the unsaved draft and renders third-party fields as text', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return {
        triggered: [{
          title: '<img onerror=alert(1)>',
          content: '很长的世界书内容',
          constant: true,
          matchMode: 'regex',
          priority: 80
        }]
      };
    }
  });
  harness.els.worldbookEditor.value = '[{"id":"draft-rule"}]';
  harness.els.worldbookTriggerInput.value = '测试文本';

  const result = await harness.controller.testWorldbookTrigger();

  assert.equal(calls[0][0], '/api/world-book/trigger-test');
  assert.deepEqual(calls[0][1].body, {
    query: '测试文本',
    worldBook: [{ id: 'draft-rule' }]
  });
  assert.equal(result.length, 1);
  assert.equal(harness.els.worldbookTriggerResult.children.length, 2);
  const row = harness.els.worldbookTriggerResult.children[1];
  assert.equal(row.children[0].children[0].textContent, '1. <img onerror=alert(1)>');
  assert.equal(row.classList.contains('constant'), true);
  assert.equal(row.children[1].textContent, 'regex · 常驻 · 优先级 80');
  assert.deepEqual(harness.statuses, [['触发 1 个条目', 'ok']]);
});

test('worldbook export uses the current draft and deterministic file name', () => {
  const downloads = [];
  const harness = createHarness({
    downloadJsonFile: (payload, fileName) => downloads.push([payload, fileName])
  });
  harness.els.worldbookEditor.value = '[{"id":"draft-export"}]';

  assert.equal(harness.controller.exportWorldbook(), true);
  assert.deepEqual(downloads, [[[{ id: 'draft-export' }], 'worldbook-2026-07-31.json']]);
  assert.deepEqual(harness.statuses, [['已导出 1 个条目', 'ok']]);

  harness.els.worldbookEditor.value = '{bad';
  assert.equal(harness.controller.exportWorldbook(), false);
  assert.equal(downloads.length, 1);
});

test('worldbook import supports replace and append while always clearing the file input', async () => {
  const replaceHarness = createHarness({ confirmAction: () => true });
  replaceHarness.els.worldbookEditor.value = '[{"id":"draft"}]';
  replaceHarness.els.worldbookImportFile.files = [{
    text: async () => '{"entries":[{"id":"imported"}]}'
  }];

  const replaced = await replaceHarness.controller.importWorldbookFromFile({
    target: replaceHarness.els.worldbookImportFile
  });
  assert.deepEqual(replaced, [{ id: 'imported' }]);
  assert.equal(replaceHarness.els.worldbookImportFile.value, '');
  assert.equal(replaceHarness.getRenderCount(), 1);

  const appendHarness = createHarness({ confirmAction: () => false });
  appendHarness.els.worldbookEditor.value = '[{"id":"draft"}]';
  appendHarness.els.worldbookImportFile.files = [{
    text: async () => '[{"id":"imported"}]'
  }];
  const appended = await appendHarness.controller.importWorldbookFromFile({
    target: appendHarness.els.worldbookImportFile
  });
  assert.deepEqual(appended, [{ id: 'draft' }, { id: 'imported' }]);
  assert.deepEqual(appendHarness.state.config.worldBook, appended);
  assert.match(appendHarness.statuses[0][0], /已追加 1 个条目/);
});

test('worldbook editor preserves an unsaved draft across redraws and resets for another session', () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  assert.equal(harness.controller.renderWorldbookEditor(), true);
  assert.equal(harness.els.worldbookEditor.value, '[{"id":"state-entry"}]');
  harness.els.worldbookEditor.value = '[{"id":"unsaved"}]';
  harness.els.worldbookEditor.dispatch('input');
  harness.state.config.worldBook = [{ id: 'server-refresh' }];

  assert.equal(harness.controller.renderWorldbookEditor(), false);
  assert.equal(harness.els.worldbookEditor.value, '[{"id":"unsaved"}]');

  harness.setSessionId('session/b');
  assert.equal(harness.controller.renderWorldbookEditor(), true);
  assert.equal(harness.els.worldbookEditor.value, '[{"id":"server-refresh"}]');
});

test('worldbook event binding is idempotent and owns browser controls', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.bindEvents();

  for (const [element, type] of [
    [harness.els.worldbookEditor, 'input'],
    [harness.els.saveWorldbook, 'click'],
    [harness.els.addWorldbookEntry, 'click'],
    [harness.els.worldbookSearch, 'input'],
    [harness.els.worldbookTypeFilter, 'change'],
    [harness.els.exportWorldbook, 'click'],
    [harness.els.importWorldbook, 'click'],
    [harness.els.worldbookImportFile, 'change'],
    [harness.els.worldbookTriggerTest, 'click'],
    [harness.els.worldbookTriggerClear, 'click']
  ]) {
    assert.equal(element.listeners.get(type).length, 1);
  }

  harness.els.importWorldbook.click();
  assert.equal(harness.els.worldbookImportFile.clickCount, 1);
  harness.els.worldbookSearch.dispatch('input');
  harness.els.worldbookTypeFilter.dispatch('change');
  assert.equal(harness.getRenderCount(), 2);
});
