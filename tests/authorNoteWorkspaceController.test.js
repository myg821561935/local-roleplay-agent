import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorNoteWorkspaceController } from '../public/modules/authorNoteWorkspace.js';

class FakeClassList {
  constructor(...tokens) {
    this.tokens = new Set(tokens);
  }

  contains(token) {
    return this.tokens.has(token);
  }

  toggle(token, force) {
    const enabled = force === undefined ? !this.tokens.has(token) : Boolean(force);
    if (enabled) this.tokens.add(token);
    else this.tokens.delete(token);
    return enabled;
  }
}

class FakeElement {
  constructor({ classes = [] } = {}) {
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList(...classes);
    this.value = '';
    this.focusCount = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, init = {}) {
    const event = {
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  focus() {
    this.focusCount += 1;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createElements() {
  return {
    appStatus: new FakeElement(),
    authorNoteInput: new FakeElement(),
    authorNotePanel: new FakeElement({ classes: ['collapsed'] }),
    toggleAuthorNote: new FakeElement()
  };
}

function createHarness(overrides = {}) {
  const els = overrides.els || createElements();
  const state = overrides.state || {
    session: {
      id: 'session/a',
      settings: { authorNote: '服务端注释' }
    }
  };
  const statuses = [];
  const calls = [];
  let sessionId = 'session/a';
  const saveSettingsPatch = overrides.saveSettingsPatch || (async (patch) => {
    calls.push(patch);
    state.session.settings = { ...(state.session.settings || {}), ...patch };
    return state.session;
  });
  const controller = createAuthorNoteWorkspaceController({
    state,
    els,
    getCurrentSessionId: () => sessionId,
    saveSettingsPatch: async (patch) => {
      if (overrides.saveSettingsPatch) calls.push(patch);
      return saveSettingsPatch(patch);
    },
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    humanizeApiError: (error) => `友好：${error.message}`
  });
  return {
    calls,
    controller,
    els,
    setSession(id, note = '') {
      sessionId = id;
      state.session = { id, settings: { authorNote: note } };
    },
    state,
    statuses
  };
}

test('author note render preserves an unsaved draft and resets it for another session', () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  assert.equal(harness.controller.renderAuthorNoteSettings(), true);
  assert.equal(harness.els.authorNoteInput.value, '服务端注释');
  assert.equal(harness.els.toggleAuthorNote.classList.contains('active'), true);

  harness.els.authorNoteInput.value = '未保存草稿';
  harness.els.authorNoteInput.dispatch('input');
  harness.state.session.settings.authorNote = '服务端刷新';

  assert.equal(harness.controller.renderAuthorNoteSettings(), false);
  assert.equal(harness.els.authorNoteInput.value, '未保存草稿');

  harness.setSession('session/b', '新会话注释');
  assert.equal(harness.controller.renderAuthorNoteSettings(), true);
  assert.equal(harness.els.authorNoteInput.value, '新会话注释');
});

test('author note panel keeps accessible expansion state and focuses when opened', () => {
  const harness = createHarness();
  harness.controller.renderAuthorNoteSettings();

  assert.equal(harness.els.toggleAuthorNote.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.els.authorNotePanel.getAttribute('aria-hidden'), 'true');
  assert.equal(harness.controller.toggleAuthorNotePanel(), true);
  assert.equal(harness.els.toggleAuthorNote.getAttribute('aria-expanded'), 'true');
  assert.equal(harness.els.authorNotePanel.getAttribute('aria-hidden'), 'false');
  assert.equal(harness.els.authorNoteInput.focusCount, 1);
  assert.equal(harness.controller.toggleAuthorNotePanel(), false);
});

test('shortcut save followed by blur deduplicates the same pending note', async () => {
  const request = deferred();
  const harness = createHarness({
    saveSettingsPatch: () => request.promise
  });
  harness.controller.bindEvents();
  harness.controller.renderAuthorNoteSettings();
  harness.els.authorNoteInput.value = '同一份草稿';
  harness.els.authorNoteInput.dispatch('input');

  const event = harness.els.authorNoteInput.dispatch('keydown', {
    key: 'Enter',
    ctrlKey: true
  });
  harness.els.authorNoteInput.dispatch('blur');

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.calls, [{ authorNote: '同一份草稿' }]);
  request.resolve({ id: 'session/a', settings: { authorNote: '同一份草稿' } });
  await harness.controller.saveAuthorNote();
  assert.match(harness.statuses.at(-1)[0], /已保存/);
});

test('unchanged blur is a no-op after the server note has rendered', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.renderAuthorNoteSettings();

  harness.els.authorNoteInput.dispatch('blur');

  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.statuses, []);
});

test('author note save does not overwrite edits made while pending', async () => {
  const request = deferred();
  const harness = createHarness({
    saveSettingsPatch: () => request.promise
  });
  harness.controller.bindEvents();
  harness.controller.renderAuthorNoteSettings();
  harness.els.authorNoteInput.value = '第一次保存';
  harness.els.authorNoteInput.dispatch('input');

  const pending = harness.controller.saveAuthorNote();
  harness.els.authorNoteInput.value = '请求期间的新修改';
  harness.els.authorNoteInput.dispatch('input');
  request.resolve({ id: 'session/a', settings: { authorNote: '第一次保存' } });
  await pending;

  assert.equal(harness.els.authorNoteInput.value, '请求期间的新修改');
  assert.match(harness.statuses.at(-1)[0], /还有未保存修改/);
});

test('late author note response cannot overwrite the newly selected session draft', async () => {
  const request = deferred();
  const harness = createHarness({
    saveSettingsPatch: () => request.promise
  });
  harness.controller.bindEvents();
  harness.controller.renderAuthorNoteSettings();
  harness.els.authorNoteInput.value = '旧会话修改';
  harness.els.authorNoteInput.dispatch('input');

  const pending = harness.controller.saveAuthorNote();
  harness.setSession('session/b', '新会话注释');
  harness.controller.renderAuthorNoteSettings();
  request.resolve({ id: 'session/a', settings: { authorNote: '旧会话修改' } });
  await pending;

  assert.equal(harness.els.authorNoteInput.value, '新会话注释');
  assert.match(harness.statuses.at(-1)[0], /原会话作者注释已保存/);
});

test('reverting while another note is pending queues the latest value', async () => {
  const first = deferred();
  const second = deferred();
  let requestIndex = 0;
  const harness = createHarness({
    saveSettingsPatch: () => [first, second][requestIndex++].promise
  });
  harness.controller.bindEvents();
  harness.controller.renderAuthorNoteSettings();
  harness.els.authorNoteInput.value = '待保存新值';
  harness.els.authorNoteInput.dispatch('input');
  const firstSave = harness.controller.saveAuthorNote();

  harness.els.authorNoteInput.value = '服务端注释';
  harness.els.authorNoteInput.dispatch('input');
  const secondSave = harness.controller.saveAuthorNote();

  assert.deepEqual(harness.calls, [
    { authorNote: '待保存新值' },
    { authorNote: '服务端注释' }
  ]);
  first.resolve({ id: 'session/a', settings: { authorNote: '待保存新值' } });
  second.resolve({ id: 'session/a', settings: { authorNote: '服务端注释' } });
  await Promise.all([firstSave, secondSave]);
  assert.match(harness.statuses.at(-1)[0], /已保存/);
});

test('failed author note save remains retryable', async () => {
  let attempt = 0;
  const harness = createHarness({
    saveSettingsPatch: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network');
      return { id: 'session/a', settings: { authorNote: '重试内容' } };
    }
  });
  harness.controller.bindEvents();
  harness.controller.renderAuthorNoteSettings();
  harness.els.authorNoteInput.value = '重试内容';
  harness.els.authorNoteInput.dispatch('input');

  assert.equal(await harness.controller.saveAuthorNote(), null);
  assert.match(harness.statuses.at(-1)[0], /友好：network/);
  assert.notEqual(await harness.controller.saveAuthorNote(), null);
  assert.equal(attempt, 2);
});

test('author note event binding is idempotent', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.bindEvents();

  assert.equal(harness.els.authorNoteInput.listeners.get('input').length, 1);
  assert.equal(harness.els.authorNoteInput.listeners.get('blur').length, 1);
  assert.equal(harness.els.authorNoteInput.listeners.get('keydown').length, 1);
});
