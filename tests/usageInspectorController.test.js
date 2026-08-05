import test from 'node:test';
import assert from 'node:assert/strict';

import {
  USAGE_REFRESH_INTERVAL_MS,
  createUsageInspectorController,
  formatUsageTask,
  getAssistantUsageRows,
  summarizeUsageFromMessages
} from '../public/modules/usageInspector.js';
import {
  formatTokenCount,
  normalizeTokenNumber
} from '../public/modules/utils.js';

class FakeElement {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
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

  dispatch(type) {
    (this.listeners.get(type) || []).forEach((listener) => listener({ target: this }));
  }
}

const documentObject = {
  createElement: () => new FakeElement()
};

function makeUsage(overrides = {}) {
  return {
    generatedAt: '2026-07-31T08:00:00.000Z',
    totals: {
      calls: 1,
      promptTokens: 1000,
      completionTokens: 300,
      totalTokens: 1300
    },
    byTask: [],
    byProvider: [],
    recent: [],
    ...overrides
  };
}

test('usage helpers normalize assistant rows, aggregate totals, and label tasks', () => {
  const messages = [
    { role: 'user', content: '忽略' },
    {
      role: 'assistant',
      usage: {
        providerId: 'primary',
        model: 'model-a',
        promptTokens: '10.2',
        completionTokens: 5,
        totalTokens: 16,
        injectedCards: -1
      }
    },
    {
      role: 'assistant',
      usage: {
        providerId: 'fallback',
        model: 'model-b',
        promptTokens: 4,
        completionTokens: 6,
        totalTokens: 10,
        estimated: false
      }
    },
    { role: 'assistant', content: '无用量' }
  ];

  assert.deepEqual(getAssistantUsageRows(messages), [
    {
      providerId: 'primary',
      model: 'model-a',
      promptTokens: 11,
      completionTokens: 5,
      totalTokens: 16,
      injectedCards: 0,
      estimated: true
    },
    {
      providerId: 'fallback',
      model: 'model-b',
      promptTokens: 4,
      completionTokens: 6,
      totalTokens: 10,
      injectedCards: 0,
      estimated: false
    }
  ]);

  const summary = summarizeUsageFromMessages(messages, 'session-a');
  assert.deepEqual(summary.totals, {
    calls: 2,
    promptTokens: 15,
    completionTokens: 11,
    totalTokens: 26,
    estimatedCalls: 1,
    providerReportedCalls: 1
  });
  assert.equal(summary.recent[0].providerId, 'fallback');
  assert.equal(summary.recent[1].messageId, 'local-0');
  assert.equal(formatUsageTask('fact'), '事实提取');
  assert.equal(formatUsageTask('custom-task'), 'custom-task');
  assert.equal(normalizeTokenNumber('3.1'), 4);
  assert.equal(normalizeTokenNumber(-3), 0);
  assert.equal(formatTokenCount(1234), '1,234');
});

test('usage renderer owns summary, task, provider, and recent-call sections', () => {
  const usageView = new FakeElement();
  const state = {
    usage: makeUsage({
      byTask: [{ taskKey: 'fact', calls: 1, totalTokens: 1300, fallbackCalls: 1 }],
      byProvider: [{
        providerId: 'primary',
        model: 'model-a',
        calls: 1,
        totalTokens: 1300,
        promptTokens: 1000,
        completionTokens: 300,
        estimatedCalls: 1,
        providerReportedCalls: 0
      }],
      recent: [{
        taskKey: 'chat',
        providerId: 'primary',
        model: 'model-a',
        totalTokens: 1300,
        promptTokens: 1000,
        completionTokens: 300,
        injectedCards: 2,
        fallbackUsed: true,
        requestedProviderId: 'preferred',
        durationMs: 80,
        estimated: true
      }]
    })
  };
  const controller = createUsageInspectorController({
    state,
    els: { usageView },
    getCurrentSessionId: () => 'session-a',
    documentObject
  });

  controller.renderUsageView();

  assert.equal(usageView.children.length, 4);
  assert.equal(usageView.children[0].className, 'usage-summary');
  assert.equal(usageView.children[0].children[0].children[1].textContent, '1,300');
  assert.equal(usageView.children[1].children[0].children[0].textContent, '任务 · 事实提取');
  assert.match(usageView.children[2].children[0].children[1].textContent, /估算 1/);
  assert.match(usageView.children[3].children[0].children[0].textContent, /session-a · 叙事对话/);
  assert.match(usageView.children[3].children[0].children[1].textContent, /已从 preferred 回退/);
});

test('usage loading builds the exact scope query and restores controls', async () => {
  const usageView = new FakeElement();
  const usageScope = new FakeElement();
  const refreshUsage = new FakeElement();
  const statuses = [];
  const paths = [];
  const state = {};
  usageScope.value = 'session';
  const controller = createUsageInspectorController({
    state,
    els: {
      usageView,
      usageScope,
      refreshUsage,
      usageStatus: new FakeElement()
    },
    getCurrentSessionId: () => 'session/a',
    apiRequest: async (path) => {
      paths.push(path);
      return { usage: makeUsage() };
    },
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    formatTime: () => '07-31 16:00',
    documentObject
  });

  const result = await controller.loadUsageStats();
  assert.equal(result, state.usage);
  assert.equal(paths[0], '/api/usage?scope=session&sessionId=session%2Fa');
  assert.deepEqual(statuses, [
    ['正在刷新用量...', 'busy'],
    ['已更新 07-31 16:00', 'ok']
  ]);
  assert.equal(refreshUsage.disabled, false);

  usageScope.value = 'all';
  await controller.loadUsageStats({ silent: true });
  assert.equal(paths[1], '/api/usage?scope=all');
});

test('usage loading reports interactive failures but keeps silent polling quiet', async () => {
  const refreshUsage = new FakeElement();
  const statuses = [];
  const controller = createUsageInspectorController({
    state: {},
    els: {
      usageView: new FakeElement(),
      usageScope: new FakeElement(),
      refreshUsage,
      usageStatus: new FakeElement()
    },
    apiRequest: async () => {
      throw new Error('offline');
    },
    setStatus: (_element, text, tone) => statuses.push([text, tone]),
    humanizeApiError: (error) => `友好：${error.message}`,
    documentObject
  });

  assert.equal(await controller.loadUsageStats(), null);
  assert.deepEqual(statuses, [
    ['正在刷新用量...', 'busy'],
    ['刷新失败：友好：offline', 'error']
  ]);
  assert.equal(refreshUsage.disabled, false);

  statuses.length = 0;
  assert.equal(await controller.loadUsageStats({ silent: true }), null);
  assert.deepEqual(statuses, []);
});

test('newer usage requests win across session switches', async () => {
  let resolveFirst;
  let currentSessionId = 'first';
  let callCount = 0;
  const state = {};
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const controller = createUsageInspectorController({
    state,
    els: {
      usageView: new FakeElement(),
      usageScope: Object.assign(new FakeElement(), { value: 'session' }),
      refreshUsage: new FakeElement(),
      usageStatus: new FakeElement()
    },
    getCurrentSessionId: () => currentSessionId,
    apiRequest: async () => {
      callCount += 1;
      if (callCount === 1) return first;
      return { usage: makeUsage({ totals: { calls: 1, promptTokens: 2, completionTokens: 0, totalTokens: 2 } }) };
    },
    documentObject
  });

  const olderRequest = controller.loadUsageStats({ silent: true });
  currentSessionId = 'second';
  await controller.loadUsageStats({ silent: true });
  resolveFirst({
    usage: makeUsage({ totals: { calls: 1, promptTokens: 99, completionTokens: 0, totalTokens: 99 } })
  });
  await olderRequest;

  assert.equal(state.usage.totals.totalTokens, 2);
});

test('usage polling and event binding are idempotent and visibility-aware', () => {
  const refreshUsage = new FakeElement();
  const usageScope = Object.assign(new FakeElement(), { value: 'all' });
  const visibilityDocument = { hidden: true };
  const cleared = [];
  const scheduled = [];
  let apiCalls = 0;
  const controller = createUsageInspectorController({
    state: {},
    els: {
      usageView: new FakeElement(),
      usageScope,
      refreshUsage,
      usageStatus: new FakeElement()
    },
    apiRequest: async () => {
      apiCalls += 1;
      return { usage: makeUsage() };
    },
    documentObject,
    visibilityDocument,
    setIntervalImpl: (callback, milliseconds) => {
      const timer = { callback, milliseconds, id: scheduled.length + 1 };
      scheduled.push(timer);
      return timer;
    },
    clearIntervalImpl: (timer) => cleared.push(timer),
    refreshIntervalMs: USAGE_REFRESH_INTERVAL_MS
  });

  controller.bindEvents();
  controller.bindEvents();
  assert.equal(refreshUsage.listeners.get('click').length, 1);
  assert.equal(usageScope.listeners.get('change').length, 1);

  const firstTimer = controller.startPolling();
  const secondTimer = controller.startPolling();
  assert.equal(scheduled[0].milliseconds, 30000);
  assert.deepEqual(cleared, [firstTimer]);

  secondTimer.callback();
  assert.equal(apiCalls, 0);
  visibilityDocument.hidden = false;
  secondTimer.callback();
  assert.equal(apiCalls, 1);
  refreshUsage.dispatch('click');
  usageScope.dispatch('change');
  assert.equal(apiCalls, 3);

  controller.stopPolling();
  assert.deepEqual(cleared, [firstTimer, secondTimer]);
});
