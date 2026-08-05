import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFactCardsController,
  createFactTemplate,
  FACT_TYPE_OPTIONS,
  factSignature,
  isPersistedFactId,
  normalizeFactType,
  normalizeUiFact,
  splitFactKeywords
} from '../public/modules/factCards.js';

function dataAttributeToProperty(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (selector.startsWith('.')) {
    return String(element.className || '').split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('[data-')) {
    const attribute = selector.slice(1, -1);
    return Object.hasOwn(element.dataset, dataAttributeToProperty(attribute));
  }
  return element.tagName === selector.toUpperCase();
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeElement {
  constructor(tagName, { fragment = false } = {}) {
    this.tagName = tagName.toUpperCase();
    this.isFragment = fragment;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
    this.listeners = new Map();
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      if (node.isFragment) {
        this.append(...node.children);
        node.children = [];
        return;
      }
      node.parentElement = this;
      this.children.push(node);
    });
  }

  querySelector(selector) {
    if (selector === '.fact-enabled input') {
      return descendantsOf(this).find((element) => (
        element.tagName === 'INPUT' && element.parentElement?.closest('.fact-enabled')
      )) || null;
    }
    return descendantsOf(this).find((element) => matchesSelector(element, selector)) || null;
  }

  querySelectorAll(selector) {
    return descendantsOf(this).filter((element) => matchesSelector(element, selector));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
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
}

function createDocument() {
  return {
    createElement: (tagName) => new FakeElement(tagName),
    createDocumentFragment: () => new FakeElement('fragment', { fragment: true })
  };
}

function createHarness({
  state = {
    session: {
      id: 'main',
      memory: { memoryCards: [] }
    },
    config: { worldBook: [] }
  },
  apiRequest = async () => ({})
} = {}) {
  const els = {
    addFact: new FakeElement('button'),
    saveFacts: new FakeElement('button'),
    factList: new FakeElement('div'),
    factStatus: new FakeElement('p')
  };
  const statuses = [];
  const promotedWorldBooks = [];
  let inspectorRefreshes = 0;
  const controller = createFactCardsController({
    state,
    els,
    apiRequest,
    getCurrentSessionId: () => 'story/session',
    replaceSession: (patch, { fallback } = {}) => {
      state.session = patch || fallback;
      return state.session;
    },
    mergeSession: (partial) => {
      state.session = { ...(state.session || {}), ...partial };
      return state.session;
    },
    refreshInspector: () => {
      inspectorRefreshes += 1;
    },
    applyPromotedWorldBook: (worldBook) => {
      promotedWorldBooks.push(worldBook);
      state.config.worldBook = worldBook || state.config.worldBook;
    },
    setStatus: (element, message, tone) => {
      element.textContent = message;
      statuses.push({ message, tone });
    },
    documentObject: createDocument()
  });

  return {
    controller,
    els,
    promotedWorldBooks,
    state,
    statuses,
    getInspectorRefreshes: () => inspectorRefreshes
  };
}

test('fact card helpers normalize legacy facts and stable signatures', () => {
  assert.deepEqual(splitFactKeywords(' 剑、江湖,\n旧案，盟约 '), ['剑', '江湖', '旧案', '盟约']);
  assert.deepEqual(normalizeUiFact(' 断剑藏在书坊 ', 2), {
    id: '',
    title: '断剑藏在书坊',
    content: '断剑藏在书坊',
    type: 'uncategorized',
    keywords: [],
    source: 'manual',
    enabled: true
  });
  assert.deepEqual(createFactTemplate(), {
    title: '新事实',
    enabled: true,
    content: '',
    type: 'uncategorized',
    keywords: [],
    source: 'manual'
  });
  assert.equal(
    factSignature({ title: ' 旧案 ', content: ' 线索 ', keywords: '剑，雨', enabled: true }),
    factSignature({ title: '旧案', content: '线索', keywords: ['剑', '雨'], enabled: true })
  );
  assert.equal(isPersistedFactId('fact-1'), true);
  assert.equal(isPersistedFactId('__index:0'), false);
  assert.equal(isPersistedFactId(''), false);
  assert.equal(normalizeFactType('rule'), 'rule');
  assert.equal(normalizeFactType('clue'), 'uncategorized');
  assert.ok(FACT_TYPE_OPTIONS.some(({ value }) => value === 'rule'));
});

test('fact card controller renders, tracks dirty state, adds and deletes local cards', async () => {
  const state = {
    session: {
      id: 'main',
      memory: {
        memoryCards: [{
          id: 'fact-1',
          title: '旧案',
          content: '断剑藏在书坊',
          type: 'clue',
          keywords: ['断剑'],
          source: 'turn-1',
          enabled: true
        }]
      }
    },
    config: { worldBook: [] }
  };
  const originalFacts = state.session.memory.memoryCards;
  const harness = createHarness({ state });
  harness.controller.bindEvents();
  harness.controller.renderFacts();

  let cards = harness.els.factList.querySelectorAll('.fact-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].querySelector('.fact-type').tagName, 'SELECT');
  assert.equal(cards[0].querySelector('.fact-type').value, 'uncategorized');
  let promote = cards[0].querySelector('[data-promote-fact]');
  assert.equal(promote.disabled, false);

  const titleInput = cards[0].querySelector('.fact-title-input');
  titleInput.value = '新标题';
  await harness.els.factList.emit('input', titleInput);
  assert.equal(promote.disabled, true);
  assert.equal(promote.title, '请先保存修改后再提升');

  await harness.els.addFact.emit('click');
  assert.notEqual(state.session.memory.memoryCards, originalFacts);
  assert.equal(state.session.memory.memoryCards.length, 2);
  cards = harness.els.factList.querySelectorAll('.fact-card');
  promote = cards[1].querySelector('[data-promote-fact]');
  assert.equal(promote.disabled, true);
  assert.equal(promote.title, '请先保存事实后再提升');

  const remove = cards[1].querySelector('[data-delete-fact]');
  await harness.els.factList.emit('click', remove);
  assert.equal(state.session.memory.memoryCards.length, 1);
  assert.equal(harness.els.factList.querySelectorAll('.fact-card').length, 1);
  assert.ok(harness.statuses.some(({ message, tone }) => message === '已删除事实，请保存' && tone === 'ok'));
});

test('fact card controller saves edited fields and replaces the session response', async () => {
  const calls = [];
  const savedSession = {
    id: 'story/session',
    memory: {
      memoryCards: [{ id: 'fact-server', title: '服务端事实' }]
    }
  };
  const harness = createHarness({
    state: {
      session: {
        id: 'story/session',
        memory: {
          memoryCards: [{
            id: 'fact-1',
            title: '旧案',
            content: '旧内容',
            type: 'clue',
            keywords: ['旧'],
            source: 'turn-1',
            enabled: true
          }]
        }
      },
      config: { worldBook: [] }
    },
    apiRequest: async (path, options) => {
      calls.push({ path, options });
      return { session: savedSession };
    }
  });
  harness.controller.bindEvents();
  harness.controller.renderFacts();
  const card = harness.els.factList.querySelector('.fact-card');
  card.querySelector('.fact-title-input').value = ' 新案 ';
  card.querySelector('.fact-content').value = ' 新内容 ';
  card.querySelector('.fact-type').value = '';
  card.querySelector('.fact-keywords').value = '剑， 雨';
  card.querySelector('.fact-source').value = '';
  card.querySelector('.fact-enabled input').checked = false;

  await harness.els.saveFacts.emit('click');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/memory/facts');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(calls[0].options.body, {
    sessionId: 'story/session',
    facts: [{
      id: 'fact-1',
      title: '新案',
      content: '新内容',
      type: 'uncategorized',
      source: 'manual',
      keywords: ['剑', '雨'],
      enabled: false
    }]
  });
  assert.equal(harness.state.session, savedSession);
  assert.equal(harness.getInspectorRefreshes(), 1);
  assert.equal(harness.els.saveFacts.disabled, false);
  assert.ok(harness.statuses.some(({ message, tone }) => message === '事实已保存' && tone === 'ok'));
});

test('fact card controller promotes only persisted, unchanged cards', async () => {
  const calls = [];
  const worldBook = [{ id: 'wb-fact-1', title: '旧案' }];
  const harness = createHarness({
    state: {
      session: {
        id: 'main',
        memory: {
          memoryCards: [{
            id: 'fact/a b',
            title: '旧案',
            content: '断剑藏在书坊',
            enabled: true
          }]
        }
      },
      config: { worldBook: [] }
    },
    apiRequest: async (path, options) => {
      calls.push({ path, options });
      return { worldBook };
    }
  });
  harness.controller.bindEvents();
  harness.controller.renderFacts();
  const card = harness.els.factList.querySelector('.fact-card');
  const promote = card.querySelector('[data-promote-fact]');

  await harness.els.factList.emit('click', promote);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/memory/facts/fact%2Fa%20b/promote');
  assert.deepEqual(calls[0].options.body, { sessionId: 'story/session' });
  assert.equal(harness.promotedWorldBooks[0], worldBook);

  card.querySelector('.fact-content').value = '已被修改';
  await harness.els.factList.emit('click', promote);
  assert.equal(calls.length, 1);
  assert.equal(promote.disabled, true);
  assert.ok(harness.statuses.some(({ message, tone }) => message === '请先保存修改后再提升' && tone === 'error'));

  await harness.controller.promoteFact('__index:1');
  assert.equal(calls.length, 1);
  assert.ok(harness.statuses.some(({ message, tone }) => message === '请先保存事实后再提升' && tone === 'error'));
});
