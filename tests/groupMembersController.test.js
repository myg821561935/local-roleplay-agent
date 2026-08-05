import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGroupMembersController,
  getEnabledGroupMemberNames,
  validateGroupMembers
} from '../public/modules/groupMembers.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
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

  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      await listener({ target: this, ...event });
    }
  }
}

const documentObject = {
  createElement: (tagName) => new FakeElement(tagName)
};

function createHarness(overrides = {}) {
  const state = overrides.state || {
    config: {
      groupMembers: [{
        id: 'member-shen',
        name: '沈观澜',
        role: '刀客',
        description: '旧案追查者',
        personality: '沉稳',
        systemPrompt: '言简意赅',
        enabled: true,
        extensions: { speechStyle: '克制' }
      }]
    },
    targetSpeaker: ''
  };
  const els = {
    groupMembersList: new FakeElement(),
    addGroupMember: new FakeElement('button'),
    saveGroupMembers: new FakeElement('button'),
    groupMembersStatus: new FakeElement()
  };
  const statuses = [];
  const notifications = [];
  const calls = [];
  const controller = createGroupMembersController({
    state,
    els,
    apiRequest: overrides.apiRequest || (async (path, options) => {
      calls.push([path, options]);
      return { groupMembers: options.body.groupMembers };
    }),
    setStatus: (_element, message, tone) => statuses.push([message, tone]),
    humanizeApiError: (error) => `友好：${error.message}`,
    onMembersChanged: (members) => notifications.push(members),
    documentObject,
    createMemberId: () => 'member-created'
  });
  return { calls, controller, els, notifications, state, statuses };
}

test('group member helpers filter disabled speakers and reject invalid identities', () => {
  assert.deepEqual(getEnabledGroupMemberNames([
    { name: ' 沈观澜 ' },
    { name: '陆无咎', enabled: false },
    { name: '沈观澜' },
    null
  ]), ['沈观澜']);
  assert.deepEqual(validateGroupMembers([{ name: '' }]), {
    valid: false,
    message: '第 1 位成员缺少角色名'
  });
  assert.equal(validateGroupMembers([{ name: '沈观澜' }, { name: ' 沈观澜 ' }]).valid, false);
  assert.deepEqual(validateGroupMembers([{ name: '沈观澜' }, { name: '陆无咎' }]), {
    valid: true,
    message: ''
  });
});

test('group member rendering exposes enabled state and safely tolerates malformed rows', () => {
  const harness = createHarness({
    state: {
      config: {
        groupMembers: [
          { name: '<img onerror=alert(1)>', enabled: false },
          null
        ]
      }
    }
  });

  harness.controller.renderGroupMembers();

  assert.equal(harness.els.groupMembersList.children.length, 2);
  const firstHeader = harness.els.groupMembersList.children[0].children[0];
  assert.equal(firstHeader.children[0].value, '<img onerror=alert(1)>');
  assert.equal(firstHeader.children[2].children[0].checked, false);
  assert.equal(firstHeader.children[2].children[1].textContent, '启用');
  assert.equal(harness.els.groupMembersList.children[1].children[0].children[0].value, '');
});

test('delegated member edits, enable toggles, add and delete keep state synchronized', async () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.renderGroupMembers();

  const row = harness.els.groupMembersList.children[0];
  const nameInput = row.children[0].children[0];
  nameInput.value = '沈照夜';
  await harness.els.groupMembersList.dispatch('input', { target: nameInput });
  assert.equal(harness.state.config.groupMembers[0].name, '沈照夜');

  const enabledInput = row.children[0].children[2].children[0];
  enabledInput.checked = false;
  await harness.els.groupMembersList.dispatch('change', { target: enabledInput });
  assert.equal(harness.state.config.groupMembers[0].enabled, false);

  await harness.els.addGroupMember.dispatch('click');
  assert.equal(harness.state.config.groupMembers[1].id, 'member-created');
  const remove = harness.els.groupMembersList.children[0].children[0].children[3];
  await harness.els.groupMembersList.dispatch('click', { target: remove });
  assert.deepEqual(harness.state.config.groupMembers.map((member) => member.id), ['member-created']);
  assert.equal(harness.notifications.length, 4);
});

test('group member save blocks blank or duplicate names before persistence', async () => {
  const harness = createHarness({
    state: {
      config: {
        groupMembers: [{ name: '沈观澜' }, { name: ' 沈观澜 ' }]
      }
    }
  });

  assert.equal(await harness.controller.saveGroupMembersConfig(), null);
  assert.equal(harness.calls.length, 0);
  assert.match(harness.statuses[0][0], /重复/);
  assert.equal(harness.statuses[0][1], 'error');
});

test('group member save uses the API result and preserves compatibility metadata in the request', async () => {
  const calls = [];
  const harness = createHarness({
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      return {
        groupMembers: [{
          ...options.body.groupMembers[0],
          name: '沈观澜',
          role: '归一化身份'
        }]
      };
    }
  });

  const result = await harness.controller.saveGroupMembersConfig();

  assert.equal(calls[0][0], '/api/group-members');
  assert.equal(calls[0][1].body.sessionId, 'main');
  assert.equal(calls[0][1].body.groupMembers[0].extensions.speechStyle, '克制');
  assert.equal(result[0].role, '归一化身份');
  assert.equal(harness.state.config.groupMembers[0].role, '归一化身份');
  assert.equal(harness.els.saveGroupMembers.disabled, false);
  assert.deepEqual(harness.statuses, [
    ['正在保存...', 'busy'],
    ['已保存 1 位成员', 'ok']
  ]);
});

test('group member event binding is idempotent and owns all member controls', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.bindEvents();

  for (const [element, type] of [
    [harness.els.addGroupMember, 'click'],
    [harness.els.saveGroupMembers, 'click'],
    [harness.els.groupMembersList, 'click'],
    [harness.els.groupMembersList, 'input'],
    [harness.els.groupMembersList, 'change']
  ]) {
    assert.equal(element.listeners.get(type).length, 1);
  }
});
