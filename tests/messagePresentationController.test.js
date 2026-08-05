import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMessagePresentationController,
  isWebSearchToolMessage,
  shouldHideAuxiliaryMessage
} from '../public/modules/messagePresentation.js';

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
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.type = '';
    this.dateTime = '';
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  get childElementCount() {
    return this.children.length;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

function findByClass(element, className) {
  return descendantsOf(element).find((child) => (
    child.className.split(/\s+/).includes(className) || child.classList.contains(className)
  ));
}

function findAllByClass(element, className) {
  return descendantsOf(element).filter((child) => (
    child.className.split(/\s+/).includes(className) || child.classList.contains(className)
  ));
}

function createHarness() {
  const documentObject = new FakeDocument();
  const renderCalls = [];
  const state = {
    config: {
      characterCard: {
        name: '叶惊弦',
        portrait: 'portrait.png'
      }
    }
  };
  const controller = createMessagePresentationController({
    state,
    documentObject,
    createCharacterPortraitImage: (character, className, fallbackName) => {
      const image = documentObject.createElement('img');
      image.className = className;
      image.dataset.characterName = character.name;
      image.title = fallbackName;
      return image;
    },
    formatTime: (value) => `时间:${value || '--'}`,
    formatTokenCount: (value) => String(Number(value || 0)),
    getLightFrontendContext: () => ({ scene: '江陵府' }),
    renderMessageContent: (options) => {
      renderCalls.push(options);
      const rendered = documentObject.createElement('p');
      rendered.textContent = options.visibleContent;
      options.container.append(rendered);
    },
    extractPresentation: (content) => ({
      content: `可见:${content}`,
      speaker: '叶惊弦',
      recommendedActions: ['观察四周', '拔剑示警']
    })
  });
  return { controller, renderCalls };
}

test('assistant presentation owns portrait, swipe, usage, bookmark and safe content rendering', () => {
  const { controller, renderCalls } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/1',
    role: 'assistant',
    content: '<plot>雨落长街</plot>',
    createdAt: '2026-07-30T10:00:00.000Z',
    swipes: ['分支一', '分支二'],
    activeSwipeIndex: 1,
    usage: {
      totalTokens: 42,
      promptTokens: 30,
      completionTokens: 12,
      providerId: 'mock',
      model: 'narrator',
      estimated: false
    },
    bookmarked: true,
    bookmarkLabel: '初遇'
  });

  assert.equal(article.className, 'message assistant');
  assert.equal(findByClass(article, 'message-role').textContent, '叶惊弦');
  assert.ok(findByClass(article, 'message-role').classList.contains('speaker-name'));
  assert.equal(findByClass(article, 'message-avatar').dataset.characterName, '叶惊弦');
  assert.equal(findByClass(article, 'swipe-count').textContent, '分支 2/2');
  assert.equal(findByClass(article, 'usage-badge').textContent, '42 tokens');
  assert.match(findByClass(article, 'usage-badge').title, /Provider: mock/);
  assert.equal(findByClass(article, 'bookmark-badge').textContent, '🔖 初遇');

  const swipeButtons = findAllByClass(article, 'swipe-arrow');
  assert.equal(swipeButtons[0].dataset.swipePrev, 'assistant/1');
  assert.equal(swipeButtons[1].dataset.swipeNext, 'assistant/1');
  assert.deepEqual(renderCalls[0], {
    container: findByClass(article, 'message-content'),
    visibleContent: '可见:<plot>雨落长街</plot>',
    role: 'assistant',
    context: { role: 'assistant', scene: '江陵府' },
    messageId: 'assistant/1'
  });

  const tools = findAllByClass(findByClass(article, 'message-tools'), 'tool-button');
  assert.deepEqual(tools.map((button) => button.textContent), ['编辑', '重生成', '排除', '取消书签']);
  const recommendations = findAllByClass(article, 'recommendation-button');
  assert.deepEqual(recommendations.map((button) => button.dataset.recommendedAction), ['观察四周', '拔剑示警']);
});

test('user presentation stays plain and exposes only user-safe message tools', () => {
  const { controller, renderCalls } = createHarness();
  const article = controller.createMessageNode({
    id: 'user/1',
    role: 'user',
    content: '我推门而入',
    excluded: true
  });

  assert.ok(article.classList.contains('excluded'));
  assert.equal(findByClass(article, 'message-role').textContent, '你');
  assert.equal(findByClass(article, 'message-avatar'), undefined);
  assert.equal(renderCalls[0].visibleContent, '我推门而入');
  assert.deepEqual(
    findAllByClass(findByClass(article, 'message-tools'), 'tool-button').map((button) => button.textContent),
    ['编辑', '包含', '加书签']
  );
  assert.equal(findByClass(article, 'recommended-actions'), undefined);
  assert.equal(findByClass(article, 'usage-badge').hidden, true);
});

test('invalid swipe indexes fall back safely and blank recommendations do not create numbering gaps', () => {
  const { controller } = createHarness();
  const switcher = controller.createSwipeSwitcher({
    id: 'assistant/2',
    swipes: ['分支一', '分支二'],
    activeSwipeIndex: 99
  });
  assert.equal(findByClass(switcher, 'swipe-count').textContent, '分支 1/2');

  const actions = controller.createRecommendedActionsNode([
    '',
    '  观察窗外  ',
    null,
    '拔剑'
  ]);
  const buttons = findAllByClass(actions, 'recommendation-button');
  assert.deepEqual(buttons.map((button) => button.dataset.recommendedAction), ['观察窗外', '拔剑']);
  assert.deepEqual(
    buttons.map((button) => findByClass(button, 'recommendation-number').textContent),
    ['01', '02']
  );
  assert.equal(controller.createRecommendedActionsNode(['', null]), null);
});

test('assistant community panels render as safe native disclosure sections', () => {
  const { controller } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/community',
    role: 'assistant',
    content: '她把水杯放在桌边。',
    roleplayPanels: {
      sceneStatus: '时间：下午5:42\n地点：咖啡厅',
      communityComment: '没有硬追问，分寸感尚可。',
      directorNotes: '用户输入较短，本轮需要推进到新的信息节点。'
    }
  });

  const panels = findByClass(article, 'message-community-panels');
  const details = findAllByClass(panels, 'message-community-panel');
  assert.equal(details.length, 3);
  assert.deepEqual(details.map((item) => item.children[0].textContent), ['◷ 场景信息', '🐱 咪咪点评', '◇ 生成记录']);
  assert.match(details[0].children[1].textContent, /下午5:42/);
  assert.match(details[1].children[1].textContent, /分寸感尚可/);
  assert.match(details[2].children[1].textContent, /已从故事正文中分离/);
  assert.doesNotMatch(details[2].children[1].textContent, /用户输入较短/);
});

test('imported web-search floors become native disclosures and hide their empty thinking preface', () => {
  const { controller, renderCalls } = createHarness();
  const searchMessage = {
    id: 'system/search',
    role: 'system',
    content: '检索到两条庄园档案。',
    extra: { tool_invocations: [{ name: 'WebSearch', displayName: 'Web Search' }] }
  };
  const article = controller.createMessageNode(searchMessage);

  assert.equal(isWebSearchToolMessage(searchMessage), true);
  assert.ok(article.classList.contains('message-auxiliary'));
  assert.equal(findByClass(article, 'message-role').textContent, '检索工具');
  assert.equal(renderCalls.at(-1).visibleContent, '');
  assert.equal(findByClass(article, 'message-community-panel-toolActivity').children[0].textContent, '⌕ 检索记录');
  assert.equal(
    shouldHideAuxiliaryMessage({ role: 'assistant', content: '', extra: { reasoning: '正在搜索' } }, searchMessage),
    true
  );
  assert.equal(
    shouldHideAuxiliaryMessage({ role: 'assistant', content: '正文', extra: { reasoning: '思考' } }, searchMessage),
    false
  );
});
