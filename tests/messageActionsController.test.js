import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMessageActionsController,
  getSwipeTargetIndex
} from '../public/modules/messageActions.js';

function dataAttributeToProperty(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (!selector.startsWith('[data-')) return false;
  const attribute = selector.slice(1, -1).split('=')[0];
  return Object.hasOwn(element.dataset, dataAttributeToProperty(attribute));
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeElement {
  constructor() {
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.disabled = false;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    return descendantsOf(this).filter((element) => selectors.some((part) => matchesSelector(element, part)));
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async emit(type, target = this) {
    for (const handler of this.listeners.get(type) || []) {
      await handler({ target, currentTarget: this });
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function createControl(datasetKey, messageId) {
  const control = new FakeElement();
  control.dataset[datasetKey] = messageId;
  return control;
}

function createHarness({
  apiRequest = async () => null,
  promptValues = [],
  promptUser,
  decodeImmersiveAction = (value) => value
} = {}) {
  const messages = new FakeElement();
  const controls = {
    edit: createControl('editMessage', 'user/1'),
    regenerate: createControl('regenerateMessage', 'assistant/1'),
    visibility: createControl('toggleVisibility', 'user/1'),
    swipePrevious: createControl('swipePrev', 'assistant/1'),
    swipeNext: createControl('swipeNext', 'assistant/1'),
    bookmark: createControl('toggleBookmark', 'assistant/1')
  };
  messages.append(...Object.values(controls));

  const state = {
    chatStreaming: false,
    session: {
      id: 'story/session',
      messages: [
        { id: 'user/1', role: 'user', content: '旧行动' },
        {
          id: 'assistant/1',
          role: 'assistant',
          content: '分支一',
          swipes: ['分支一', '分支二'],
          activeSwipeIndex: 0,
          bookmarked: false,
          bookmarkLabel: ''
        }
      ]
    }
  };
  const statuses = [];
  const requests = [];
  const recommendedActions = [];
  let renderCount = 0;
  let inspectorCount = 0;
  let replaceCount = 0;
  let promptIndex = 0;
  const els = {
    messages,
    appStatus: { name: 'app' },
    sessionStatus: { name: 'session' }
  };
  const controller = createMessageActionsController({
    state,
    els,
    apiRequest: async (...args) => {
      requests.push(args);
      const payload = await apiRequest(...args);
      return payload || { session: state.session };
    },
    getCurrentSessionId: () => state.session.id,
    replaceSession: (session) => {
      replaceCount += 1;
      state.session = session;
      return session;
    },
    renderMessages: () => { renderCount += 1; },
    refreshInspector: () => { inspectorCount += 1; },
    setStatus: (element, message, tone) => statuses.push({ element: element.name, message, tone }),
    humanizeApiError: (error) => error.message,
    decodeImmersiveAction,
    onRecommendedAction: (action, element) => recommendedActions.push({ action, element }),
    promptUser: promptUser || (() => promptValues[promptIndex++])
  });

  return {
    controller,
    controls,
    els,
    recommendedActions,
    requests,
    state,
    statuses,
    counts: () => ({ renderCount, inspectorCount, replaceCount })
  };
}

test('swipe target helper wraps valid branches and rejects no-op or invalid state', () => {
  const message = { swipes: ['一', '二', '三'], activeSwipeIndex: 0 };
  assert.equal(getSwipeTargetIndex(message, -1), 2);
  assert.equal(getSwipeTargetIndex(message, 1), 1);
  assert.equal(getSwipeTargetIndex(message, 0), -1);
  assert.equal(getSwipeTargetIndex({ swipes: ['一'] }, 1), -1);
  assert.equal(getSwipeTargetIndex({ swipes: ['一', '二'], activeSwipeIndex: 8 }, 1), -1);
});

test('message mutations use the exact endpoint contracts and refresh session-owned views', async () => {
  const harness = createHarness({ promptValues: ['新行动', '关键线索'] });

  await harness.controller.editMessage('user/1');
  await harness.controller.regenerateMessage('assistant/1');
  await harness.controller.toggleMessageVisibility('user/1');
  await harness.controller.switchMessageSwipe('assistant/1', 1);
  await harness.controller.toggleMessageBookmark('assistant/1');

  assert.deepEqual(harness.requests, [
    ['/api/messages/user%2F1', {
      method: 'PATCH',
      body: { sessionId: 'story/session', content: '新行动' }
    }],
    ['/api/messages/assistant%2F1/regenerate', {
      method: 'POST',
      body: { sessionId: 'story/session' }
    }],
    ['/api/messages/user%2F1/visibility', {
      method: 'POST',
      body: { sessionId: 'story/session' }
    }],
    ['/api/messages/assistant%2F1/swipe', {
      method: 'POST',
      body: { sessionId: 'story/session', swipeIndex: 1 }
    }],
    ['/api/messages/assistant%2F1/bookmark', {
      method: 'POST',
      body: { sessionId: 'story/session', label: '关键线索' }
    }]
  ]);
  assert.deepEqual(harness.counts(), {
    renderCount: 5,
    inspectorCount: 5,
    replaceCount: 5
  });
  assert.ok(harness.statuses.some(({ message, tone }) => (
    message === '正在编辑并重生成后续回复...' && tone === 'busy'
  )));
  assert.ok(harness.statuses.some(({ message, tone }) => (
    message === '已切换到分支 2/2' && tone === 'ok'
  )));
});

test('assistant edits do not claim regeneration and empty edits never reach the API', async () => {
  const harness = createHarness({ promptValues: ['改写旁白', '   '] });

  await harness.controller.editMessage('assistant/1');
  await harness.controller.editMessage('user/1');

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0][0], '/api/messages/assistant%2F1');
  assert.ok(harness.statuses.some(({ message }) => message === '正在编辑旁白回复...'));
  assert.ok(harness.statuses.some(({ message }) => message === '旁白回复已编辑'));
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '消息内容不能为空',
    tone: 'error'
  });
});

test('unsupported native prompts are contained and reported without mutating messages', async () => {
  const harness = createHarness({
    promptUser: () => {
      throw new Error('prompt() is not supported');
    }
  });

  await harness.controller.editMessage('assistant/1');
  await harness.controller.toggleMessageBookmark('assistant/1');

  assert.equal(harness.requests.length, 0);
  assert.deepEqual(harness.statuses, [
    {
      element: 'session',
      message: '无法打开消息编辑框：prompt() is not supported',
      tone: 'error'
    },
    {
      element: 'session',
      message: '无法打开书签命名框：prompt() is not supported',
      tone: 'error'
    }
  ]);
});

test('streaming and an in-flight message mutation share one concurrency lock', async () => {
  let resolveRequest;
  const pendingRequest = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const harness = createHarness({ apiRequest: () => pendingRequest });

  const regeneration = harness.controller.regenerateMessage('assistant/1');
  assert.equal(harness.controller.isBusy(), true);
  assert.ok(Object.values(harness.controls).every((control) => control.disabled));
  assert.ok(Object.values(harness.controls).every((control) => control.attributes.get('aria-busy') === 'true'));

  await harness.controller.toggleMessageVisibility('user/1');
  assert.equal(harness.requests.length, 1);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '上一项消息操作仍在处理中',
    tone: 'busy'
  });

  resolveRequest({ session: harness.state.session });
  await regeneration;
  assert.equal(harness.controller.isBusy(), false);
  assert.ok(Object.values(harness.controls).every((control) => !control.disabled));

  harness.state.chatStreaming = true;
  harness.controller.syncActionState();
  await harness.controller.regenerateMessage('assistant/1');
  assert.equal(harness.requests.length, 1);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '旁白仍在生成，请等待本轮完成后再修改历史消息',
    tone: 'busy'
  });

  harness.state.chatStreaming = false;
  harness.state.conversationActionPending = true;
  harness.controller.syncActionState();
  await harness.controller.regenerateMessage('assistant/1');
  assert.equal(harness.requests.length, 1);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '另一项对话行动仍在处理中，请稍候',
    tone: 'busy'
  });
  assert.ok(Object.values(harness.controls).every((control) => control.disabled));
});

test('message event delegation is idempotent and preserves recommended action routing', async () => {
  const harness = createHarness({
    decodeImmersiveAction: (value) => `decoded:${value}`
  });
  const recommendation = createControl('recommendedAction', '观察四周');
  const immersive = createControl('immersiveOptionAction', '拔剑');
  harness.els.messages.append(recommendation, immersive);

  harness.controller.bindEvents();
  harness.controller.bindEvents();
  assert.equal(harness.els.messages.listeners.get('click').length, 1);

  await harness.els.messages.emit('click', recommendation);
  await harness.els.messages.emit('click', immersive);
  await harness.els.messages.emit('click', harness.controls.visibility);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(harness.recommendedActions.map(({ action }) => action), [
    '观察四周',
    'decoded:拔剑'
  ]);
  assert.equal(harness.requests[0][0], '/api/messages/user%2F1/visibility');
});
