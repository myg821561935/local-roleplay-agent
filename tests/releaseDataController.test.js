import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReleaseDataController,
  formatBackupTime,
  formatBytes
} from '../public/modules/releaseData.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true) this.values.add(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(name, tagName = 'div') {
    this.name = name;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.href = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (!value) this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async emit(type) {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      target: this,
      currentTarget: this
    };
    for (const handler of this.listeners.get(type) || []) {
      await handler(event);
    }
    return event;
  }
}

function backup(id, overrides = {}) {
  return {
    id,
    createdAt: '2026-07-31T08:30:00.000Z',
    totalBytes: 1536,
    fileCount: 3,
    reason: 'manual',
    ...overrides
  };
}

function createHarness({
  apiRequest = async () => ({}),
  reloadAppState = async () => {},
  confirmAction = () => true
} = {}) {
  const createElement = (name, tagName = 'div') => new FakeElement(name, tagName);
  const els = {
    releaseVersion: createElement('releaseVersion'),
    createBackup: createElement('createBackup', 'button'),
    backupSelect: createElement('backupSelect', 'select'),
    downloadBackup: createElement('downloadBackup', 'a'),
    restoreBackup: createElement('restoreBackup', 'button'),
    backupStatus: createElement('backupStatus')
  };
  const requests = [];
  const statuses = [];
  let reloads = 0;
  let confirmations = 0;
  let lastConfirmation = '';

  const controller = createReleaseDataController({
    els,
    apiRequest: async (...args) => {
      requests.push(args);
      return apiRequest(...args);
    },
    reloadAppState: async () => {
      reloads += 1;
      return reloadAppState();
    },
    setStatus: (element, message, tone) => statuses.push({
      element: element?.name,
      message,
      tone
    }),
    humanizeApiError: (error) => `友好错误：${error.message}`,
    confirmAction: (message) => {
      confirmations += 1;
      lastConfirmation = message;
      return confirmAction(message);
    },
    documentObject: {
      createElement: (tagName) => createElement(tagName, tagName)
    }
  });

  return {
    controller,
    els,
    requests,
    statuses,
    getReloads: () => reloads,
    getConfirmations: () => confirmations,
    getLastConfirmation: () => lastConfirmation
  };
}

test('release data formatting keeps byte units and invalid timestamps readable', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
  assert.equal(formatBackupTime('not-a-date'), 'not-a-date');
  assert.equal(formatBackupTime(''), '未知时间');
});

test('release state loads health and backups while preserving a valid selection', async () => {
  const backups = [backup('newest'), backup('selected', { totalBytes: 2 * 1024 * 1024 })];
  const harness = createHarness({
    apiRequest: async (url) => {
      if (url === '/api/health') return { version: '0.5.0', dataSchemaVersion: 3 };
      return { backups, invalidCount: 2 };
    }
  });
  harness.els.backupSelect.value = 'selected';

  const result = await harness.controller.loadReleaseState();

  assert.equal(result.health.version, '0.5.0');
  assert.equal(harness.els.releaseVersion.textContent, 'v0.5.0 · 数据 v3');
  assert.deepEqual(harness.els.backupSelect.children.map((option) => option.value), ['newest', 'selected']);
  assert.equal(harness.els.backupSelect.value, 'selected');
  assert.match(harness.els.backupSelect.children[1].textContent, /完整备份 · 2\.0 MB · manual/);
  assert.equal(harness.els.restoreBackup.disabled, false);
  assert.equal(harness.els.downloadBackup.href, '/api/backups/selected/download');
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'backupStatus',
    message: '发现 2 个无效快照，已忽略',
    tone: 'error'
  });
});

test('empty or failed release state disables restore and download safely', async () => {
  const empty = createHarness({
    apiRequest: async (url) => (
      url === '/api/health'
        ? { version: '0.5.0', dataSchemaVersion: 3 }
        : { backups: [] }
    )
  });
  await empty.controller.loadReleaseState();
  assert.equal(empty.els.backupSelect.children[0].textContent, '暂无备份');
  assert.equal(empty.els.backupSelect.value, '');
  assert.equal(empty.els.restoreBackup.disabled, true);
  assert.equal(empty.els.downloadBackup.href, '#');
  assert.equal(empty.els.downloadBackup.classList.contains('is-disabled'), true);

  const failure = createHarness({
    apiRequest: async () => {
      throw new Error('disk unavailable');
    }
  });
  assert.equal(await failure.controller.loadReleaseState(), null);
  assert.deepEqual(failure.statuses.at(-1), {
    element: 'backupStatus',
    message: '备份状态读取失败：友好错误：disk unavailable',
    tone: 'error'
  });
});

test('backup creation serializes all backup actions and selects the new snapshot', async () => {
  let resolveCreate;
  const pendingCreate = new Promise((resolve) => {
    resolveCreate = resolve;
  });
  const created = backup('created', { totalBytes: 2048, fileCount: 4 });
  const harness = createHarness({
    apiRequest: async (url, options = {}) => {
      if (url === '/api/backups' && options.method === 'POST') return pendingCreate;
      if (url === '/api/health') return { version: '0.5.0', dataSchemaVersion: 3 };
      return { backups: [created, backup('older')] };
    }
  });
  harness.controller.renderBackupOptions([backup('older')]);

  const createPromise = harness.controller.createBackup();
  assert.equal(harness.controller.isOperationPending(), true);
  assert.equal(harness.els.createBackup.disabled, true);
  assert.equal(harness.els.restoreBackup.disabled, true);
  assert.equal(harness.els.downloadBackup.classList.contains('is-disabled'), true);
  assert.equal(await harness.controller.restoreBackup(), null);
  assert.equal(harness.getConfirmations(), 0);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.statuses.at(-1).message, /仍在处理中/);

  resolveCreate({ backup: created });
  assert.equal(await createPromise, created);
  assert.equal(harness.els.backupSelect.value, 'created');
  assert.equal(harness.els.createBackup.disabled, false);
  assert.equal(harness.els.restoreBackup.disabled, false);
  assert.equal(harness.els.downloadBackup.href, '/api/backups/created/download');
  assert.equal(harness.controller.isOperationPending(), false);
});

test('backup restore requires confirmation, encodes the id and reloads app state', async () => {
  const cancelled = createHarness({ confirmAction: () => false });
  cancelled.controller.renderBackupOptions([backup('cancelled')]);
  assert.equal(await cancelled.controller.restoreBackup(), null);
  assert.equal(cancelled.requests.length, 0);
  assert.equal(cancelled.controller.isOperationPending(), false);
  assert.equal(cancelled.els.restoreBackup.disabled, false);

  const selected = backup('snapshot/with space');
  const restoredBackups = [selected, backup('safety')];
  const success = createHarness({
    apiRequest: async (url) => {
      if (url.includes('/restore')) return { safetyBackup: { id: 'safety' } };
      if (url === '/api/health') return { version: '0.5.0', dataSchemaVersion: 3 };
      return { backups: restoredBackups };
    }
  });
  success.controller.renderBackupOptions([selected]);
  const result = await success.controller.restoreBackup();

  assert.equal(result.safetyBackup.id, 'safety');
  assert.equal(success.getConfirmations(), 1);
  assert.equal(success.requests[0][0], '/api/backups/snapshot%2Fwith%20space/restore');
  assert.deepEqual(success.requests[0][1], { method: 'POST', body: {} });
  assert.equal(success.getReloads(), 1);
  assert.match(success.statuses.find((status) => status.message.includes('恢复完成')).message, /安全备份：safety/);
  assert.equal(success.controller.isOperationPending(), false);
});

test('selected deletion backups are labeled and explain their bounded restore scope', async () => {
  const harness = createHarness();
  harness.controller.renderBackupOptions([backup('selected', { scope: 'selected' })]);

  await harness.controller.restoreBackup();

  assert.match(harness.els.backupSelect.children[0].textContent, /范围备份/);
  assert.match(harness.getLastConfirmation(), /只会还原其中列出的项目、剧本和会话文件/);
});

test('release data event binding is idempotent and blocks empty download links', async () => {
  const { controller, els } = createHarness();
  controller.bindEvents();
  controller.bindEvents();
  controller.renderBackupOptions([]);

  assert.equal(els.createBackup.listeners.get('click').length, 1);
  assert.equal(els.backupSelect.listeners.get('change').length, 1);
  assert.equal(els.restoreBackup.listeners.get('click').length, 1);
  assert.equal(els.downloadBackup.listeners.get('click').length, 1);
  assert.equal((await els.downloadBackup.emit('click')).defaultPrevented, true);
});
