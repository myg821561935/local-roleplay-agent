import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPersonaWorkspaceController,
  readPersonaDraft
} from '../public/modules/personaWorkspace.js';

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ target: this });
    }
  }
}

function createElements() {
  return {
    personaEnabled: new FakeElement(),
    personaName: new FakeElement(),
    personaDescription: new FakeElement(),
    personaBackground: new FakeElement(),
    personaPersonality: new FakeElement(),
    savePersona: new FakeElement(),
    personaStatus: new FakeElement()
  };
}

function createHarness(overrides = {}) {
  const els = overrides.els || createElements();
  const state = overrides.state || {
    config: {
      persona: {
        enabled: true,
        name: '顾怀砚',
        description: '旧案调查者',
        background: '来自江南',
        personality: '谨慎'
      }
    }
  };
  const statuses = [];
  let sessionId = 'session/a';
  const controller = createPersonaWorkspaceController({
    state,
    els,
    apiRequest: overrides.apiRequest,
    getCurrentSessionId: () => sessionId,
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    humanizeApiError: (error) => `友好：${error.message}`
  });
  return {
    controller,
    els,
    state,
    statuses,
    setSessionId: (value) => {
      sessionId = value;
    }
  };
}

test('persona draft reader trims text and preserves the enabled switch', () => {
  const els = createElements();
  els.personaEnabled.checked = true;
  els.personaName.value = '  林渡  ';
  els.personaDescription.value = ' 游侠 ';
  els.personaBackground.value = ' 江南 ';
  els.personaPersonality.value = ' 克制 ';

  assert.deepEqual(readPersonaDraft(els), {
    enabled: true,
    name: '林渡',
    description: '游侠',
    background: '江南',
    personality: '克制'
  });
});

test('persona editor preserves an unsaved draft across redraws and resets for another session', () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  assert.equal(harness.controller.renderPersona(), true);
  assert.equal(harness.els.personaName.value, '顾怀砚');
  harness.els.personaName.value = '未保存名字';
  harness.els.personaName.dispatch('input');
  harness.state.config.persona = {
    enabled: false,
    name: '服务端刷新',
    description: '',
    background: '',
    personality: ''
  };

  assert.equal(harness.controller.renderPersona(), false);
  assert.equal(harness.els.personaName.value, '未保存名字');

  harness.setSessionId('session/b');
  assert.equal(harness.controller.renderPersona(), true);
  assert.equal(harness.els.personaName.value, '服务端刷新');
});

test('persona save uses the current session and server-normalized response', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return {
        persona: {
          enabled: true,
          name: '林渡',
          description: '游侠',
          background: '江南',
          personality: '克制'
        }
      };
    }
  });
  harness.els.personaEnabled.checked = true;
  harness.els.personaName.value = '  林渡 ';
  harness.els.personaDescription.value = ' 游侠 ';
  harness.els.personaBackground.value = ' 江南 ';
  harness.els.personaPersonality.value = ' 克制 ';

  const saved = await harness.controller.savePersona();

  assert.deepEqual(calls, [[
    '/api/persona',
    {
      method: 'PUT',
      body: {
        sessionId: 'session/a',
        persona: {
          enabled: true,
          name: '林渡',
          description: '游侠',
          background: '江南',
          personality: '克制'
        }
      }
    }
  ]]);
  assert.equal(saved.name, '林渡');
  assert.equal(harness.state.config.persona.name, '林渡');
  assert.equal(harness.els.personaName.value, '林渡');
  assert.equal(harness.els.savePersona.disabled, false);
  assert.deepEqual(harness.statuses, [
    ['正在保存...', 'busy'],
    ['人设已保存', 'ok']
  ]);
});

test('persona save does not overwrite edits made while the request is pending', async () => {
  let resolveRequest;
  const harness = createHarness({
    apiRequest: () => new Promise((resolve) => {
      resolveRequest = resolve;
    })
  });
  harness.controller.bindEvents();
  harness.controller.renderPersona();
  harness.els.personaName.value = '第一次保存';

  const pending = harness.controller.savePersona();
  harness.els.personaName.value = '请求期间的新修改';
  harness.els.personaName.dispatch('input');
  resolveRequest({
    persona: {
      enabled: true,
      name: '第一次保存',
      description: '旧案调查者',
      background: '来自江南',
      personality: '谨慎'
    }
  });
  await pending;

  assert.equal(harness.state.config.persona.name, '第一次保存');
  assert.equal(harness.els.personaName.value, '请求期间的新修改');
  assert.match(harness.statuses.at(-1)[0], /还有未保存修改/);
});

test('late persona response cannot replace the newly selected session state', async () => {
  let resolveRequest;
  const harness = createHarness({
    apiRequest: () => new Promise((resolve) => {
      resolveRequest = resolve;
    })
  });
  harness.els.personaName.value = '旧会话';
  const pending = harness.controller.savePersona();
  harness.setSessionId('session/b');
  harness.state.config.persona = {
    enabled: false,
    name: '新会话',
    description: '',
    background: '',
    personality: ''
  };
  harness.controller.renderPersona();
  resolveRequest({
    persona: {
      enabled: true,
      name: '旧会话',
      description: '',
      background: '',
      personality: ''
    }
  });
  await pending;

  assert.equal(harness.state.config.persona.name, '新会话');
  assert.equal(harness.els.personaName.value, '新会话');
  assert.match(harness.statuses.at(-1)[0], /原会话人设已保存/);
});

test('persona event binding is idempotent and owns every editor control', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.bindEvents();

  assert.equal(harness.els.personaEnabled.listeners.get('change').length, 1);
  for (const element of [
    harness.els.personaName,
    harness.els.personaDescription,
    harness.els.personaBackground,
    harness.els.personaPersonality
  ]) {
    assert.equal(element.listeners.get('input').length, 1);
  }
  assert.equal(harness.els.savePersona.listeners.get('click').length, 1);
});
