import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODULE_HELP,
  createModuleHelpController,
  resolveModuleHelpKey
} from '../public/modules/moduleHelp.js';

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(token) {
    this.tokens.add(token);
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class FakeElement {
  constructor(documentObject, tagName = 'div') {
    this.documentObject = documentObject;
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.isConnected = false;
    this.style = {};
    this.textContent = '';
    this.rect = { left: 0, right: 0, top: 0, bottom: 0, width: 220, height: 110 };
  }

  set className(value) {
    this.classList = new FakeClassList();
    String(value || '').split(/\s+/).filter(Boolean).forEach((token) => this.classList.add(token));
  }

  get className() {
    return [...this.classList.tokens].join(' ');
  }

  append(...children) {
    this.children.push(...children);
  }

  getBoundingClientRect() {
    return this.rect;
  }

  remove() {
    this.isConnected = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.nodes = [];
    this.body = {
      append: (node) => {
        node.isConnected = true;
        this.nodes.push(node);
      }
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  querySelector(selector) {
    if (selector !== '.module-hint-popover') return null;
    return this.nodes.find((node) => node.isConnected && node.classList.contains('module-hint-popover')) || null;
  }
}

function createAnchor(documentObject, rect = {}) {
  const anchor = new FakeElement(documentObject, 'button');
  anchor.dataset = { helpKey: 'authoring' };
  anchor.rect = {
    left: 100,
    right: 180,
    top: 100,
    bottom: 132,
    width: 80,
    height: 32,
    ...rect
  };
  return anchor;
}

function createTarget({ trigger = null, close = false, inside = false } = {}) {
  return {
    closest(selector) {
      if (selector === '[data-module-hint-close]') return close ? this : null;
      if (selector === '.module-hint-popover') return inside ? this : null;
      if (selector.includes(',')) return trigger;
      return null;
    }
  };
}

function createHarness({ queuedFrames = false } = {}) {
  const documentObject = new FakeDocument();
  const frames = [];
  const timers = [];
  const clearedTimers = [];
  const controller = createModuleHelpController({
    documentObject,
    windowObject: { innerWidth: 800, innerHeight: 600 },
    requestFrame: (callback) => {
      if (queuedFrames) frames.push(callback);
      else callback();
    },
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => clearedTimers.push(timer)
  });
  return { clearedTimers, controller, documentObject, frames, timers };
}

test('module help resolver uses explicit data contracts and covers the authoring ledger', () => {
  assert.equal(resolveModuleHelpKey({ dataset: { helpKey: 'authoring' } }), 'authoring');
  assert.equal(resolveModuleHelpKey({ dataset: { tab: 'memory' } }), 'memory');
  assert.equal(resolveModuleHelpKey({ dataset: { tabShortcut: 'character' } }), 'character');
  assert.equal(resolveModuleHelpKey({ dataset: { actionTemplate: 'repair' } }), 'format');
  assert.equal(resolveModuleHelpKey({ dataset: { scrollBottom: '' } }), 'scrollBottom');
  assert.equal(resolveModuleHelpKey({ id: 'legacy-only', dataset: {} }), '');
  assert.match(MODULE_HELP.authoring.body, /伏笔承诺/);
  assert.equal(MODULE_HELP.openingGenre, undefined);
});

test('module help renders safe accessible content and positions it beside the anchor', () => {
  const harness = createHarness();
  const popover = harness.controller.showModuleHint(
    'authoring',
    createAnchor(harness.documentObject)
  );

  assert.ok(popover);
  assert.equal(popover.getAttribute('role'), 'dialog');
  assert.equal(popover.getAttribute('aria-modal'), 'false');
  assert.equal(popover.children[1].textContent, '创作账本');
  assert.match(popover.children[2].textContent, /场景目标/);
  assert.equal(popover.style.left, '100px');
  assert.equal(popover.style.top, '140px');
  assert.equal(popover.classList.contains('visible'), true);
  assert.equal(harness.timers[0].delay, 5200);

  harness.timers[0].callback();
  assert.equal(popover.isConnected, false);
});

test('module help flips above a low anchor and keeps the popover inside the viewport', () => {
  const harness = createHarness();
  const anchor = createAnchor(harness.documentObject, {
    left: 760,
    right: 790,
    top: 540,
    bottom: 572
  });
  const popover = harness.controller.showModuleHint('character', anchor);

  assert.equal(popover.style.left, '568px');
  assert.equal(popover.style.top, '422px');
});

test('closing before a queued frame prevents a stale popover from becoming visible', () => {
  const harness = createHarness({ queuedFrames: true });
  const popover = harness.controller.showModuleHint(
    'authoring',
    createAnchor(harness.documentObject)
  );

  harness.controller.closeModuleHint();
  harness.frames[0]();

  assert.equal(popover.isConnected, false);
  assert.equal(popover.classList.contains('visible'), false);
  assert.equal(harness.clearedTimers.length, 1);
});

test('module help click handling opens known triggers and closes on outside or close clicks', () => {
  const harness = createHarness();
  const anchor = createAnchor(harness.documentObject);
  harness.controller.handleModuleHelpClick({
    target: createTarget({ trigger: anchor })
  });
  assert.ok(harness.documentObject.querySelector('.module-hint-popover'));

  harness.controller.handleModuleHelpClick({ target: createTarget() });
  assert.equal(harness.documentObject.querySelector('.module-hint-popover'), null);

  harness.controller.showModuleHint('authoring', anchor);
  harness.controller.handleModuleHelpClick({
    target: createTarget({ close: true })
  });
  assert.equal(harness.documentObject.querySelector('.module-hint-popover'), null);
});

test('module help event binding is idempotent', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.bindEvents();

  assert.equal(harness.documentObject.listeners.get('click').length, 1);
});
